/**
 * Instância pg-boss (ADR-006). Schema `pgboss` no mesmo banco.
 * A aplicação/worker conecta com o papel `nett_app` (sem DDL), por isso `migrate: false`
 * e `createSchema: false`: o schema é instalado por `src/server/jobs/setup.ts` com o papel migrator.
 */
import { PgBoss } from 'pg-boss';

export const PGBOSS_SCHEMA = 'pgboss';

const g = globalThis as unknown as { __nettBoss?: Promise<PgBoss> };

export function createBoss(connectionString: string, opts: { migrate?: boolean; supervise?: boolean; schedule?: boolean } = {}): PgBoss {
  const boss = new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: 'nett-licita-jobs',
    max: Number(process.env.JOBS_POOL_MAX ?? 5),
    migrate: opts.migrate ?? false,
    createSchema: opts.migrate ?? false,
    supervise: opts.supervise ?? false,
    schedule: opts.schedule ?? false,
  });
  // Erros internos do pg-boss (manutenção, conexão) não podem derrubar o processo silenciosamente.
  boss.on('error', (error) => console.error('[jobs] pg-boss', error instanceof Error ? error.message : error));
  return boss;
}

/** Instância compartilhada do processo (web e worker), iniciada sob demanda. */
export function getBoss(): Promise<PgBoss> {
  if (!g.__nettBoss) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não configurada');
    const boss = createBoss(url);
    g.__nettBoss = boss.start().catch((error) => {
      g.__nettBoss = undefined;
      throw error;
    });
  }
  return g.__nettBoss;
}

export async function stopBoss(): Promise<void> {
  const pending = g.__nettBoss;
  g.__nettBoss = undefined;
  if (pending) await (await pending).stop({ graceful: true, timeout: 30_000 });
}
