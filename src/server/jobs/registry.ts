/**
 * Registro de handlers. Cada agente registra o handler da fila de que é dono
 * (coluna `owner` em `src/contracts/jobs.ts`). Handlers DEVEM ser idempotentes e só enfileirar
 * próximos passos via `enqueue` — nunca chamar outro handler diretamente.
 */
import type { PgBoss } from 'pg-boss';
import type { JobName, JobPayload } from '@/contracts/jobs';
import { InvalidJobPayload, parsePayload } from './enqueue';

export type JobContext = { jobId: string; retryCount: number; signal: AbortSignal };
export type JobHandler<N extends JobName> = (payload: JobPayload<N>, ctx: JobContext) => Promise<void>;

type AnyHandler = (payload: unknown, ctx: JobContext) => Promise<void>;

export class JobRegistry {
  private readonly handlers = new Map<JobName, AnyHandler>();

  register<N extends JobName>(name: N, handler: JobHandler<N>): this {
    if (this.handlers.has(name)) throw new Error(`handler já registrado para ${name}`);
    this.handlers.set(name, handler as AnyHandler);
    return this;
  }

  names(): JobName[] {
    return [...this.handlers.keys()];
  }

  /** Executa o handler validando o payload novamente (o banco é fronteira de confiança). */
  async run(name: JobName, data: unknown, ctx: JobContext): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`nenhum handler registrado para ${name}`);
    await handler(parsePayload(name, data), ctx);
  }

  /** Liga os handlers ao pg-boss. Retorna os ids dos workers. */
  async attach(boss: PgBoss, options: { concurrency?: number; pollingIntervalSeconds?: number } = {}): Promise<string[]> {
    const ids: string[] = [];
    for (const name of this.names()) {
      const id = await boss.work(
        name,
        { batchSize: 1, localConcurrency: options.concurrency ?? 1, pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 },
        async ([job]) => {
          if (!job) return;
          const inicio = Date.now();
          try {
            await this.run(name, job.data, { jobId: job.id, retryCount: job.retryCount, signal: job.signal });
            log('info', 'job.completed', { name, id: job.id, retry: job.retryCount, ms: Date.now() - inicio });
          } catch (error) {
            log('error', 'job.failed', {
              name,
              id: job.id,
              retry: job.retryCount,
              ms: Date.now() - inicio,
              error: error instanceof Error ? error.message : String(error),
              invalidPayload: error instanceof InvalidJobPayload,
            });
            // pg-boss registra a falha e aplica retryLimit/backoff da fila.
            throw error;
          }
        },
      );
      ids.push(id);
    }
    return ids;
  }
}

/** Log estruturado (JSON por linha). Nunca registrar payload de documento, segredo ou dado pessoal. */
export function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`);
}
