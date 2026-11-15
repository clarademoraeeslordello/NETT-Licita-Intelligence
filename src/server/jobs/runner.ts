/**
 * Processo worker (ADR-002): conecta ao pg-boss, liga os handlers registrados e encerra de forma
 * graciosa em SIGTERM/SIGINT (termina os jobs em andamento antes de sair).
 */
import { createBoss } from './boss';
import { JobRegistry, log } from './registry';

export type WorkerHandle = { stop(): Promise<void> };

export async function startWorker(registry: JobRegistry, options: { connectionString?: string; concurrency?: number; pollingIntervalSeconds?: number } = {}): Promise<WorkerHandle> {
  const url = options.connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada');
  // O worker supervisiona (expiração/retenção) — papel nett_app tem DML no schema pgboss.
  const boss = createBoss(url, { supervise: true });
  await boss.start();
  const missing = [];
  for (const name of registry.names()) if (!(await boss.getQueue(name))) missing.push(name);
  if (missing.length) {
    await boss.stop({ graceful: false });
    throw new Error(`filas ausentes (${missing.join(', ')}): execute src/server/jobs/setup.ts com o papel migrator`);
  }
  await registry.attach(boss, options);
  log('info', 'worker.started', { queues: registry.names() });
  return {
    async stop() {
      await boss.stop({ graceful: true, timeout: 60_000 });
      log('info', 'worker.stopped');
    },
  };
}
