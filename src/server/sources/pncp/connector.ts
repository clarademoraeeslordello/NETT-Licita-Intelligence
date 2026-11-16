/**
 * `SourceConnector` do PNCP sobre o cliente herdado (`src/lib/pncp/client.ts`): mantém cache,
 * deduplicação de requisições, retentativa com backoff e o disjuntor do /consulta.
 *
 * Paginação: /consulta/v1/contratacoes/atualizacao (compras novas OU alteradas no dia), por
 * modalidade × dia, do dia `since` até `until` (padrão: hoje). O cursor é JSON serializável e
 * retomável (guardado em `Source.lastCursor` por T-202).
 *
 * `fetchPage` devolve só a compra (barato: 1 requisição por 50 registros). `enrich` acrescenta itens
 * e arquivos (2+ requisições por compra) e deve ser chamado apenas para registros relevantes
 * (filtro por SearchProfile em T-202), respeitando o limite da fonte.
 */
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { pncpGet } from '@/lib/pncp/client';
import { abrirDisjuntorConsulta, consultaBloqueada } from '@/lib/pncp/disjuntor';
import type { FetchPageResult, NormalizeResult, SyncableConnector } from '../connector';
import { normalizePncp, partesControle, type PncpPayload } from './normalize';

export const PNCP_SOURCE_KEY = 'pncp';
export const PAGE_SIZE = 50; // máximo aceito pela API de consulta
const ITENS_POR_PAGINA = 100;
const MAX_PAGINAS_ITENS = 20;

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const pncpCursor = z.object({
  v: z.literal(1),
  day: dia,
  until: dia,
  modalities: z.array(z.number().int().positive()).min(1),
  modalityIndex: z.number().int().nonnegative(),
  page: z.number().int().positive(),
});
export type PncpCursor = z.infer<typeof pncpCursor>;

/** Data YYYY-MM-DD no fuso de negócio (America/Sao_Paulo). */
export function diaBrasilia(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const proximoDia = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

type RespostaConsulta = { data?: Array<{ numeroControlePNCP?: string }>; totalPaginas?: number; totalRegistros?: number };

export type PncpConnectorOptions = {
  /** Modalidades PNCP (Lei 14.133). Padrão: 4 concorrência eletrônica, 6 pregão eletrônico, 8 dispensa. */
  modalities?: number[];
  /** Primeiro dia (inclusive) quando não há cursor. Padrão: hoje (Brasília). */
  since?: Date;
  /** Último dia (inclusive). Padrão: hoje (Brasília). */
  until?: Date;
  now?: () => Date;
};

export class PncpConnector implements SyncableConnector {
  readonly key = PNCP_SOURCE_KEY;
  get definition() {
    return {
      name: 'Portal Nacional de Contratações Públicas (PNCP)',
      kind: 'api' as const,
      baseUrl: 'https://pncp.gov.br/api',
      // Limites próprios, conservadores (a API pública não publica cota oficial).
      rateLimit: { requestsPerMinute: 60, maxConcurrency: 2 },
      config: { modalities: this.modalities, pageSize: PAGE_SIZE },
    };
  }
  private readonly modalities: number[];
  private readonly now: () => Date;

  constructor(private readonly options: PncpConnectorOptions = {}) {
    this.modalities = options.modalities?.length ? options.modalities : [4, 6, 8];
    this.now = options.now ?? (() => new Date());
  }

  initialCursor(): PncpCursor {
    const hoje = diaBrasilia(this.now());
    return {
      v: 1,
      day: this.options.since ? diaBrasilia(this.options.since) : hoje,
      until: this.options.until ? diaBrasilia(this.options.until) : hoje,
      modalities: this.modalities,
      modalityIndex: 0,
      page: 1,
    };
  }

  cursorFrom(since: Date | null): PncpCursor {
    const c = this.initialCursor();
    return since ? { ...c, day: diaBrasilia(since) } : c;
  }

  /** Cursor salvo: estende `until` até hoje e respeita mudança de modalidades na configuração. */
  resumeCursor(saved: unknown): PncpCursor | null {
    const parsed = pncpCursor.safeParse(saved);
    if (!parsed.success) return null;
    const c = parsed.data;
    const hoje = diaBrasilia(this.now());
    if (JSON.stringify(c.modalities) !== JSON.stringify(this.modalities)) {
      return { ...c, modalities: this.modalities, modalityIndex: 0, page: 1, until: hoje };
    }
    return { ...c, until: c.until < hoje ? hoje : c.until };
  }

  listingOf(payload: unknown): unknown {
    return (payload as Partial<PncpPayload> | null)?.compra ?? null;
  }

  isEnriched(payload: unknown): boolean {
    const p = payload as Partial<PncpPayload> | null;
    return Array.isArray(p?.itens) && Array.isArray(p?.arquivos);
  }

  private async consulta<T>(path: string): Promise<T> {
    if (consultaBloqueada()) throw new AppError('PNCP_UNAVAILABLE', 'Consulta do PNCP em pausa pelo disjuntor.', { status: 503 });
    try {
      // Paginação de sincronização não usa cache: cada leitura precisa refletir a fonte.
      return await pncpGet<T>(path, { ttlMs: 0, timeoutMs: 45_000, retries: 2 });
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'NOT_FOUND')) abrirDisjuntorConsulta();
      throw error;
    }
  }

  async fetchPage(cursor: unknown | null): Promise<FetchPageResult & { nextCursor: PncpCursor | null; totalPages: number }> {
    const c = cursor === null ? this.initialCursor() : pncpCursor.parse(cursor);
    const modalidade = c.modalities[c.modalityIndex]!;
    const ymd = c.day.replace(/-/g, '');
    const params = new URLSearchParams({
      dataInicial: ymd,
      dataFinal: ymd,
      codigoModalidadeContratacao: String(modalidade),
      pagina: String(c.page),
      tamanhoPagina: String(PAGE_SIZE),
    });
    const corpo = await this.consulta<RespostaConsulta | []>(`/consulta/v1/contratacoes/atualizacao?${params}`);
    const brutos = Array.isArray(corpo) ? [] : (corpo.data ?? []);
    const totalPages = Array.isArray(corpo) ? 0 : (corpo.totalPaginas ?? 0);

    const records = brutos
      .filter((r): r is { numeroControlePNCP: string } => typeof r.numeroControlePNCP === 'string')
      .map((compra) => ({ externalId: compra.numeroControlePNCP, payload: { compra } satisfies Partial<PncpPayload> as unknown }));

    return { records, nextCursor: this.advance(c, totalPages), totalPages };
  }

  /** Próxima posição: página → modalidade → dia. `null` quando alcançou `until`. */
  advance(c: PncpCursor, totalPages: number): PncpCursor | null {
    if (c.page < totalPages) return { ...c, page: c.page + 1 };
    if (c.modalityIndex + 1 < c.modalities.length) return { ...c, modalityIndex: c.modalityIndex + 1, page: 1 };
    if (c.day < c.until) return { ...c, day: proximoDia(c.day), modalityIndex: 0, page: 1 };
    return null;
  }

  /** Completa o payload com itens e arquivos (API PNCP, fora do /consulta). */
  async enrich(payload: unknown): Promise<PncpPayload> {
    const base = payload as PncpPayload;
    const p = partesControle(base.compra.numeroControlePNCP);
    if (!p) throw new AppError('BAD_REQUEST', `número de controle inválido: ${base.compra.numeroControlePNCP}`, { status: 400 });
    const raiz = `/pncp/v1/orgaos/${p.cnpj}/compras/${p.ano}/${p.sequencial}`;
    const itens: unknown[] = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS_ITENS; pagina += 1) {
      const lote = await pncpGet<unknown[]>(`${raiz}/itens?pagina=${pagina}&tamanhoPagina=${ITENS_POR_PAGINA}`, { ttlMs: 10 * 60_000 });
      itens.push(...lote);
      if (lote.length < ITENS_POR_PAGINA) break;
    }
    const arquivos = await pncpGet<unknown[]>(`${raiz}/arquivos`, { ttlMs: 10 * 60_000 });
    return { ...base, itens, arquivos } as PncpPayload;
  }

  normalize(payload: unknown): NormalizeResult {
    return normalizePncp(payload);
  }
}
