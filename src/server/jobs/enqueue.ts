/**
 * `enqueue` tipado (CONTRACTS.md §5). Valida o payload com o schema Zod do contrato e usa
 * `singletonKey` = payload serializado de forma estável: reenfileirar o mesmo trabalho enquanto
 * ele está na fila devolve o id do job existente em vez de criar outro.
 */
import type { PgBoss } from 'pg-boss';
import type { PoolClient } from 'pg';
import { jobs, type JobName, type JobPayload } from '@/contracts/jobs';
import { getBoss } from './boss';

/** JSON com chaves ordenadas — a mesma informação sempre gera a mesma chave. */
export function stableKey(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify(sort(value));
}

export class InvalidJobPayload extends Error {
  constructor(
    readonly jobName: string,
    readonly issues: unknown,
  ) {
    super(`payload inválido para a fila ${jobName}`);
    this.name = 'InvalidJobPayload';
  }
}

export function parsePayload<N extends JobName>(name: N, payload: unknown): JobPayload<N> {
  const parsed = jobs[name].payload.safeParse(payload);
  if (!parsed.success) throw new InvalidJobPayload(name, parsed.error.issues);
  return parsed.data as JobPayload<N>;
}

/** Adapta um cliente pg em transação para o pg-boss gravar o job na MESMA transação (outbox). */
export const inTransaction = (client: Pick<PoolClient, 'query'>) => ({
  executeSql: (text: string, values?: unknown[]) => client.query(text, values),
});

export type EnqueueOptions = {
  startAfter?: Date | number;
  priority?: number;
  /** Cliente pg com transação aberta: o job só existe se a transação for confirmada. */
  tx?: Pick<PoolClient, 'query'>;
};

export async function enqueueWith<N extends JobName>(boss: PgBoss, name: N, payload: JobPayload<N>, options: EnqueueOptions = {}): Promise<string> {
  const data = parsePayload(name, payload);
  const singletonKey = stableKey(data);
  const { tx, ...rest } = options;
  const db = tx ? { db: inTransaction(tx) } : {};
  const id = await boss.send(name, data as object, { singletonKey, ...rest, ...db });
  if (id) return id;
  // Já existe job equivalente na fila: devolve o id dele (idempotência).
  const [existente] = await boss.findJobs(name, { key: singletonKey, queued: true, limit: 1, ...db });
  if (existente) return existente.id;
  // Corrida rara: o equivalente saiu da fila entre o send e o find. Tenta uma vez mais.
  const retry = await boss.send(name, data as object, { singletonKey, ...rest, ...db });
  if (retry) return retry;
  throw new Error(`não foi possível enfileirar ${name}`);
}

export async function enqueue<N extends JobName>(name: N, payload: JobPayload<N>, options: EnqueueOptions = {}): Promise<string> {
  return enqueueWith(await getBoss(), name, payload, options);
}
