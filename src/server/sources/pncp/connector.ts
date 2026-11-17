/**
 * `SourceConnector` do PNCP sobre o cliente herdado (`src/lib/pncp/client.ts`): mantém cache,
 * deduplicação de requisições, retentativa com backoff e o disjuntor do /consulta.
 *
 * Dois feeds (contratos 1.5.0, ADR-023), cada um com cursor próprio dentro de `Source.lastCursor`
 * (`{ v: 2, feeds: { updates?, proposals? } }`; o formato antigo, um cursor `updates` solto, continua aceito):
 *  - `updates`  — /consulta/v1/contratacoes/atualizacao (compras novas OU alteradas no dia), por modalidade × dia,
 *                 do dia `since` até `until` (padrão: hoje).
 *  - `proposals` — /consulta/v1/contratacoes/proposta (propostas abertas até `dataFinal`), por modalidade em
 *                 sequência; uma varredura completa e depois recomeça do início (`done`).
 * Os cursores são JSON serializáveis e retomáveis.
 *
 * `fetchPage` devolve só a compra (barato: 1 requisição por 50 registros). `enrich` acrescenta itens
 * e arquivos (2+ requisições por compra) e deve ser chamado apenas para registros relevantes
 * (filtro por SearchProfile em T-202), respeitando o limite da fonte.
 *
 * HTTP 429 nunca é retentado: vira `SourceRateLimited` (o sync para e retoma depois do cooldown).
 */
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { isPncpRateLimited, pncpGet, type PncpFetchOptions } from '@/lib/pncp/client';
import { abrirDisjuntorConsulta, consultaBloqueada, consultaBloqueadaAte } from '@/lib/pncp/disjuntor';
import { SourceRateLimited, type FetchPageResult, type NormalizeResult, type SyncableConnector, type SyncFeed } from '../connector';
import { normalizePncp, partesControle, type PncpPayload } from './normalize';

export const PNCP_SOURCE_KEY = 'pncp';
export const PAGE_SIZE = 50; // máximo aceito pela API de consulta (51 → HTTP 400)
const ITENS_POR_PAGINA = 100;
const MAX_PAGINAS_ITENS = 20;
/** Pausa depois de um HTTP 429 (a retomada só ocorre depois dela). */
export const COOLDOWN_429_MS = Number(process.env.PNCP_429_COOLDOWN_MS ?? 15 * 60_000);
/** T-214: máximo de itens (com resultado) por compra cujos resultados são consultados (cada um é 1 requisição lenta). */
export const MAX_ITENS_RESULTADOS = Number(process.env.PNCP_MAX_ITENS_RESULTADOS ?? 20);
/** Até quantos dias à frente a partição `proposals` olha (`dataFinal`). */
export const PROPOSALS_HORIZON_DAYS = Number(process.env.PNCP_PROPOSALS_HORIZON_DAYS ?? 180);

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const modalidades = z.array(z.number().int().positive()).min(1);
export const pncpCursor = z.object({
  v: z.literal(1),
  day: dia,
  until: dia,
  modalities: modalidades,
  modalityIndex: z.number().int().nonnegative(),
  page: z.number().int().positive(),
});
export type PncpCursor = z.infer<typeof pncpCursor>;

/** Cursor da partição de propostas abertas: sem `day`; `until` = `dataFinal` da consulta (fixo durante a varredura). */
export const pncpProposalsCursor = z.object({
  v: z.literal(1),
  feed: z.literal('proposals'),
  until: dia,
  modalities: modalidades,
  modalityIndex: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  /** Varredura concluída: a próxima execução recomeça do início, com `until` renovado. */
  done: z.boolean().optional(),
});
export type PncpProposalsCursor = z.infer<typeof pncpProposalsCursor>;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Lê `Source.lastCursor`: formato 2 (`feeds`) ou o antigo (cursor `updates` solto). */
export function feedsOf(saved: unknown): { updates?: unknown; proposals?: unknown } {
  if (!isObj(saved)) return {};
  if (saved.v === 2 && isObj(saved.feeds)) return saved.feeds;
  if (saved.v === 1 && 'day' in saved) return { updates: saved };
  return {};
}

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
  /** Dias à frente para o `dataFinal` das propostas abertas. Padrão: `PNCP_PROPOSALS_HORIZON_DAYS` (180). */
  proposalsHorizonDays?: number;
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

  initialProposalsCursor(): PncpProposalsCursor {
    const dias = this.options.proposalsHorizonDays ?? PROPOSALS_HORIZON_DAYS;
    return {
      v: 1,
      feed: 'proposals',
      until: diaBrasilia(new Date(this.now().getTime() + dias * 86_400_000)),
      modalities: this.modalities,
      modalityIndex: 0,
      page: 1,
    };
  }

  cursorFrom(since: Date | null, feed: SyncFeed = 'updates'): PncpCursor | PncpProposalsCursor {
    if (feed === 'proposals') return this.initialProposalsCursor(); // propostas abertas não têm "desde"
    const c = this.initialCursor();
    return since ? { ...c, day: diaBrasilia(since) } : c;
  }

  /** Cursor salvo do feed: `updates` estende `until` até hoje; `proposals` retoma a varredura ou recomeça se concluída. */
  resumeCursor(saved: unknown, feed: SyncFeed = 'updates'): PncpCursor | PncpProposalsCursor | null {
    const bruto = feedsOf(saved)[feed];
    if (feed === 'proposals') {
      const parsed = pncpProposalsCursor.safeParse(bruto);
      if (!parsed.success) return null;
      const c = parsed.data;
      // Concluída, ou modalidades mudaram na configuração: nova varredura do início.
      if (c.done || JSON.stringify(c.modalities) !== JSON.stringify(this.modalities)) return this.initialProposalsCursor();
      return c;
    }
    const parsed = pncpCursor.safeParse(bruto);
    if (!parsed.success) return null;
    const c = parsed.data;
    const hoje = diaBrasilia(this.now());
    if (JSON.stringify(c.modalities) !== JSON.stringify(this.modalities)) {
      return { ...c, modalities: this.modalities, modalityIndex: 0, page: 1, until: hoje };
    }
    return { ...c, until: c.until < hoje ? hoje : c.until };
  }

  /** Grava o cursor do feed preservando o do outro feed (`Source.lastCursor` = `{ v: 2, feeds }`). */
  storeCursor(current: unknown, feed: SyncFeed, cursor: unknown): unknown {
    return { v: 2, feeds: { ...feedsOf(current), [feed]: cursor } };
  }

  completedCursor(cursor: unknown): unknown {
    return isObj(cursor) && cursor.feed === 'proposals' ? { ...cursor, done: true } : cursor;
  }

  listingOf(payload: unknown): unknown {
    return (payload as Partial<PncpPayload> | null)?.compra ?? null;
  }

  isEnriched(payload: unknown): boolean {
    const p = payload as Partial<PncpPayload> | null;
    if (!Array.isArray(p?.itens) || !Array.isArray(p?.arquivos)) return false;
    // T-214: compra com resultado só está completa depois de consultados os resultados dos itens.
    const comResultado = Boolean(p?.compra?.existeResultado) || (p?.compra?.valorTotalHomologado ?? 0) > 0;
    return !comResultado || p?.resultados != null;
  }

  /** GET ao PNCP: 429 nunca é retentado — abre o cooldown e sinaliza `SourceRateLimited`. */
  private async get<T>(path: string, options: PncpFetchOptions): Promise<T> {
    try {
      return await pncpGet<T>(path, options);
    } catch (error) {
      if (isPncpRateLimited(error)) {
        abrirDisjuntorConsulta(COOLDOWN_429_MS);
        throw new SourceRateLimited('PNCP respondeu 429; parar e retomar após o cooldown.', COOLDOWN_429_MS);
      }
      throw error;
    }
  }

  private async consulta<T>(path: string): Promise<T> {
    if (consultaBloqueada()) throw new SourceRateLimited('Consulta do PNCP em cooldown (disjuntor).', Math.max(consultaBloqueadaAte() - Date.now(), 1_000));
    try {
      // Paginação de sincronização não usa cache: cada leitura precisa refletir a fonte.
      return await this.get<T>(path, { ttlMs: 0, timeoutMs: 45_000, retries: 2 });
    } catch (error) {
      if (!(error instanceof SourceRateLimited) && !(error instanceof AppError && error.code === 'NOT_FOUND')) abrirDisjuntorConsulta();
      throw error;
    }
  }

  async fetchPage(cursor: unknown | null): Promise<FetchPageResult & { nextCursor: PncpCursor | PncpProposalsCursor | null; totalPages: number }> {
    if (isObj(cursor) && cursor.feed === 'proposals') return this.fetchProposalsPage(pncpProposalsCursor.parse(cursor));
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
    const { records, totalPages } = this.parse(corpo);
    return { records, nextCursor: this.advance(c, totalPages), totalPages };
  }

  /** Propostas abertas: /consulta/v1/contratacoes/proposta?dataFinal=…, uma modalidade por vez. */
  private async fetchProposalsPage(c: PncpProposalsCursor) {
    const params = new URLSearchParams({
      dataFinal: c.until.replace(/-/g, ''),
      codigoModalidadeContratacao: String(c.modalities[c.modalityIndex]!),
      pagina: String(c.page),
      tamanhoPagina: String(PAGE_SIZE),
    });
    const corpo = await this.consulta<RespostaConsulta | []>(`/consulta/v1/contratacoes/proposta?${params}`);
    const { records, totalPages } = this.parse(corpo);
    return { records, nextCursor: this.advanceProposals(c, totalPages), totalPages };
  }

  private parse(corpo: RespostaConsulta | []) {
    const brutos = Array.isArray(corpo) ? [] : (corpo.data ?? []);
    const totalPages = Array.isArray(corpo) ? 0 : (corpo.totalPaginas ?? 0);
    const records = brutos
      .filter((r): r is { numeroControlePNCP: string } => typeof r.numeroControlePNCP === 'string')
      .map((compra) => ({ externalId: compra.numeroControlePNCP, payload: { compra } satisfies Partial<PncpPayload> as unknown }));
    return { records, totalPages };
  }

  /** Próxima posição: página → modalidade → dia. `null` quando alcançou `until`. */
  advance(c: PncpCursor, totalPages: number): PncpCursor | null {
    if (c.page < totalPages) return { ...c, page: c.page + 1 };
    if (c.modalityIndex + 1 < c.modalities.length) return { ...c, modalityIndex: c.modalityIndex + 1, page: 1 };
    if (c.day < c.until) return { ...c, day: proximoDia(c.day), modalityIndex: 0, page: 1 };
    return null;
  }

  /** Propostas abertas: página → modalidade (em sequência). `null` ao terminar a última. */
  advanceProposals(c: PncpProposalsCursor, totalPages: number): PncpProposalsCursor | null {
    if (c.page < totalPages) return { ...c, page: c.page + 1 };
    if (c.modalityIndex + 1 < c.modalities.length) return { ...c, modalityIndex: c.modalityIndex + 1, page: 1 };
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
      const lote = await this.get<unknown[]>(`${raiz}/itens?pagina=${pagina}&tamanhoPagina=${ITENS_POR_PAGINA}`, { ttlMs: 10 * 60_000 });
      itens.push(...lote);
      if (lote.length < ITENS_POR_PAGINA) break;
    }
    const arquivos = await this.get<unknown[]>(`${raiz}/arquivos`, { ttlMs: 10 * 60_000 });
    const resultados = await this.resultados(raiz, base, itens);
    return { ...base, itens, arquivos, ...(resultados ? { resultados } : {}) } as PncpPayload;
  }

  /**
   * T-214: preço e fornecedor homologados por item (`/itens/{n}/resultados`), só para compra com resultado e para os itens
   * que o PNCP marca com `temResultado`, até `MAX_ITENS_RESULTADOS`. Sequencial (o espaçamento ≥ 1 s vale para cada chamada).
   * 404/204 de um item = sem resultado dele; 429 para tudo (`SourceRateLimited`); outra falha lança e a retentativa fica
   * com `source.enrich` (a compra não fica "enriquecida pela metade" sem resultados).
   */
  private async resultados(raiz: string, base: PncpPayload, itens: unknown[]): Promise<Record<string, unknown[]> | null> {
    const comResultado = Boolean(base.compra.existeResultado) || (base.compra.valorTotalHomologado ?? 0) > 0;
    if (!comResultado) return null;
    const numeros = (itens as Array<{ numeroItem?: number; temResultado?: boolean }>)
      .filter((i) => i.temResultado === true && Number.isInteger(i.numeroItem))
      .map((i) => i.numeroItem!)
      .slice(0, MAX_ITENS_RESULTADOS);
    const out: Record<string, unknown[]> = {};
    for (const n of numeros) {
      try {
        out[String(n)] = await this.get<unknown[]>(`${raiz}/itens/${n}/resultados`, { ttlMs: 10 * 60_000, timeoutMs: 20_000 });
      } catch (error) {
        if (error instanceof AppError && error.code === 'NOT_FOUND') out[String(n)] = [];
        else throw error;
      }
    }
    return out;
  }

  normalize(payload: unknown): NormalizeResult {
    return normalizePncp(payload);
  }
}
