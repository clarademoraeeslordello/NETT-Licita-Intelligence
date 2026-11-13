/**
 * Cliente HTTP comum aos conectores.
 *
 * Portado e generalizado de `src/lib/pncp/client.ts` (Enzo47961/licitaflow-licitacoes, MIT):
 * timeout, retentativa com backoff, deduplicação de requisições simultâneas e cache em memória.
 * Acrescenta: limitador de taxa por fonte (intervalo mínimo + concorrência), respeito a
 * Retry-After, bloqueio de métodos de escrita (clientes somente leitura) e métricas.
 */
import { log, ocultarSegredos } from '../observabilidade/log.js';
import { incrementar } from '../observabilidade/metricas.js';

export class ErroHttp extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
    readonly retentavel: boolean,
  ) {
    super(message);
    this.name = 'ErroHttp';
  }
}

export type OpcoesCliente = {
  fonte: string;
  baseUrl: string;
  /** Intervalo mínimo entre inícios de requisição (ms). */
  intervaloMinMs: number;
  concorrencia: number;
  timeoutMs: number;
  retentativas: number;
  cacheMaxEntradas?: number;
  cabecalhos?: Record<string, string>;
};

export type OpcoesGet = { ttlMs?: number; timeoutMs?: number; retentativas?: number; params?: Record<string, string | number | undefined> };

const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ClienteHttp {
  private readonly cache = new Map<string, { expira: number; valor: unknown }>();
  private readonly emAndamento = new Map<string, Promise<unknown>>();
  private ativos = 0;
  private proximoInicio = 0;
  private readonly espera: Array<() => void> = [];

  constructor(readonly opcoes: OpcoesCliente) {}

  montarUrl(caminho: string, params?: OpcoesGet['params']): string {
    const url = new URL(caminho.startsWith('http') ? caminho : `${this.opcoes.baseUrl}${caminho}`);
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    return url.toString();
  }

  async get<T>(caminho: string, opcoes: OpcoesGet = {}): Promise<T> {
    const url = this.montarUrl(caminho, opcoes.params);
    const ttl = opcoes.ttlMs ?? 0;
    const emCache = this.cache.get(url);
    if (emCache && emCache.expira > Date.now()) {
      incrementar('http_cache_acertos_total', { fonte: this.opcoes.fonte });
      return emCache.valor as T;
    }
    const pendente = this.emAndamento.get(url);
    if (pendente) return pendente as Promise<T>;

    const promessa = this.executar<T>(url, opcoes)
      .then((valor) => {
        if (ttl > 0) this.lembrar(url, valor, ttl);
        return valor;
      })
      .finally(() => this.emAndamento.delete(url));
    this.emAndamento.set(url, promessa);
    return promessa;
  }

  private lembrar(url: string, valor: unknown, ttl: number) {
    const max = this.opcoes.cacheMaxEntradas ?? 500;
    if (this.cache.size >= max) {
      const agora = Date.now();
      for (const [k, e] of this.cache) if (e.expira < agora) this.cache.delete(k);
      for (const k of this.cache.keys()) {
        if (this.cache.size < max) break;
        this.cache.delete(k);
      }
    }
    this.cache.set(url, { expira: Date.now() + ttl, valor });
  }

  /** Limitador: no máximo `concorrencia` em voo e `intervaloMinMs` entre inícios. */
  private async adquirir(): Promise<void> {
    while (this.ativos >= this.opcoes.concorrencia) await new Promise<void>((r) => this.espera.push(r));
    this.ativos += 1;
    const agora = Date.now();
    const inicio = Math.max(agora, this.proximoInicio);
    this.proximoInicio = inicio + this.opcoes.intervaloMinMs;
    if (inicio > agora) await dormir(inicio - agora);
  }

  private liberar() {
    this.ativos -= 1;
    this.espera.shift()?.();
  }

  private async executar<T>(url: string, opcoes: OpcoesGet): Promise<T> {
    const timeoutMs = opcoes.timeoutMs ?? this.opcoes.timeoutMs;
    const retentativas = opcoes.retentativas ?? this.opcoes.retentativas;
    const fonte = this.opcoes.fonte;
    let ultimo: ErroHttp | null = null;

    for (let tentativa = 0; tentativa <= retentativas; tentativa += 1) {
      if (tentativa > 0) {
        const base = 500 * 2 ** (tentativa - 1) + Math.random() * 300;
        await dormir(Math.max(base, ultimo?.status === 429 ? 30_000 : 0));
        incrementar('http_retentativas_total', { fonte });
      }
      await this.adquirir();
      const inicio = Date.now();
      try {
        const resposta = await fetch(url, {
          headers: { accept: 'application/json', ...this.opcoes.cabecalhos },
          signal: AbortSignal.timeout(timeoutMs),
        });
        incrementar('http_requisicoes_total', { fonte, status: resposta.status });
        log('debug', 'http.resposta', { fonte, url: ocultarSegredos(url), status: resposta.status, ms: Date.now() - inicio });

        if (resposta.status === 204) return [] as T;
        if (resposta.ok) {
          const texto = await resposta.text();
          return (texto ? JSON.parse(texto) : []) as T;
        }
        const retentavel = resposta.status >= 500 || resposta.status === 429;
        ultimo = new ErroHttp(`${fonte} respondeu ${resposta.status}`, resposta.status, ocultarSegredos(url), retentavel);
        if (resposta.status === 429) {
          const retryAfter = Number(resposta.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) await dormir(Math.min(retryAfter, 120) * 1000);
        }
        if (!retentavel) break;
      } catch (erro) {
        incrementar('http_falhas_rede_total', { fonte });
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        ultimo = new ErroHttp(`${fonte} falha de rede: ${mensagem}`, null, ocultarSegredos(url), true);
      } finally {
        this.liberar();
      }
    }
    throw ultimo ?? new ErroHttp(`${fonte} falhou`, null, ocultarSegredos(url), true);
  }
}
