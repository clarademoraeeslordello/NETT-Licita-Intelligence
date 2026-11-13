/**
 * Cliente HTTP da API pública do PNCP.
 *
 * A API é gratuita e sem chave, mas instável: devolve 502 esporádicos e derruba
 * conexões sob carga. Por isso toda chamada passa por timeout, retentativa com
 * backoff, deduplicação de requisições simultâneas e cache em memória — a mesma
 * busca feita pelo Painel e pelo Radar em sequência chega ao PNCP uma vez só.
 */
import { AppError } from '../errors';

export const PNCP_BASE = 'https://pncp.gov.br/api';

type CacheEntry = { expiresAt: number; value: unknown };
type ClientState = { cache: Map<string, CacheEntry>; inflight: Map<string, Promise<unknown>> };

const globalRef = globalThis as unknown as { __pncpClient?: ClientState };
const state: ClientState =
  globalRef.__pncpClient ?? (globalRef.__pncpClient = { cache: new Map(), inflight: new Map() });

const MAX_CACHE_ENTRIES = 600;

export type PncpFetchOptions = {
  /** Tempo de vida no cache. 0 desativa. */
  ttlMs?: number;
  timeoutMs?: number;
  retries?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function remember(key: string, value: unknown, ttlMs: number): void {
  if (ttlMs <= 0) return;
  if (state.cache.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [entryKey, entry] of state.cache) if (entry.expiresAt < now) state.cache.delete(entryKey);
    // Ainda cheio: descarta os mais antigos (Map preserva a ordem de inserção).
    for (const entryKey of state.cache.keys()) {
      if (state.cache.size < MAX_CACHE_ENTRIES) break;
      state.cache.delete(entryKey);
    }
  }
  state.cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

async function request<T>(url: string, timeoutMs: number, retries: number): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1) + Math.random() * 250);

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });

      // 204 = "sem registros" (ex.: compra sem itens publicados).
      if (response.status === 204) return [] as T;
      if (response.status === 404) throw new AppError('NOT_FOUND', 'Registro não encontrado no PNCP.', { status: 404 });
      if (!response.ok) {
        lastError = new Error(`PNCP respondeu ${response.status}`);
        // 4xx não melhora com retentativa — e insistir num 429 prolonga o bloqueio do IP.
        if (response.status < 500) break;
        continue;
      }

      const text = await response.text();
      return (text ? JSON.parse(text) : []) as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      lastError = error;
    }
  }

  throw new AppError('PNCP_UNAVAILABLE', 'O PNCP não respondeu a tempo.', {
    status: 503,
    hint: 'O portal oficial está instável neste momento. Tente novamente em alguns instantes.',
    details: lastError instanceof Error ? lastError.message : String(lastError),
    cause: lastError,
  });
}

/** GET com cache, deduplicação e retentativa. `path` começa com `/`. */
export async function pncpGet<T>(path: string, options: PncpFetchOptions = {}): Promise<T> {
  const { ttlMs = 5 * 60_000, timeoutMs = 15_000, retries = 2 } = options;
  const url = `${PNCP_BASE}${path}`;

  const cached = state.cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  const pending = state.inflight.get(url);
  if (pending) return pending as Promise<T>;

  const promise = request<T>(url, timeoutMs, retries)
    .then((value) => {
      remember(url, value, ttlMs);
      return value;
    })
    .finally(() => state.inflight.delete(url));

  state.inflight.set(url, promise);
  return promise;
}

/**
 * Executa `task` sobre `items` com no máximo `limit` chamadas simultâneas.
 * O PNCP começa a recusar conexões acima de ~6 requisições paralelas.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
