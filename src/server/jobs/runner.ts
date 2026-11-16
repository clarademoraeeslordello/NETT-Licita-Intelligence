/**
 * Processo worker (ADR-002): conecta ao pg-boss, liga os handlers registrados, registra
 * agendamentos e encerra de forma graciosa em SIGTERM/SIGINT.
 */
import type { PgBoss } from 'pg-boss';
import type { JobName } from '@/contracts/jobs';
import { createBoss } from './boss';
import { stableKey } from './enqueue';
import { JobRegistry, log } from './registry';

export type WorkerHandle = { boss: PgBoss; stop(): Promise<void> };
export type Schedule = { name: JobName; cron: string; data: object };

export async function startWorker(
  registry: JobRegistry | ((boss: PgBoss) => JobRegistry),
  options: { connectionString?: string; concurrency?: number; pollingIntervalSeconds?: number; schedules?: Schedule[] } = {},
): Promise<WorkerHandle> {
  const url = options.connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada');
  const schedules = options.schedules ?? [];
  // O worker supervisiona (expiração/retenção) — papel nett_app tem DML no schema pgboss.
  const boss = createBoss(url, { supervise: true, schedule: schedules.length > 0 });
  await boss.start();
  const reg = typeof registry === 'function' ? registry(boss) : registry;
  const missing = [];
  for (const name of reg.names()) if (!(await boss.getQueue(name))) missing.push(name);
  if (missing.length) {
    await boss.stop({ graceful: false });
    throw new Error(`filas ausentes (${missing.join(', ')}): execute src/server/jobs/setup.ts com o papel migrator`);
  }
  for (const sch of schedules) await boss.schedule(sch.name, sch.cron, sch.data, { tz: 'America/Sao_Paulo', key: stableKey(sch.data), singletonKey: stableKey(sch.data) });
  await reg.attach(boss, options);
  log('info', 'worker.started', { queues: reg.names(), schedules: schedules.map((s) => `${s.name} ${s.cron}`) });
  return {
    boss,
    async stop() {
      await boss.stop({ graceful: true, timeout: 60_000 });
      log('info', 'worker.stopped');
    },
  };
}
