/**
 * Instala/atualiza o schema `pgboss` e as filas do contrato. Executar com o papel MIGRATOR
 * (o papel da aplicação não tem DDL), no deploy, depois de `db:migrate`:
 *   DATABASE_URL_MIGRATOR=... npx tsx src/server/jobs/setup.ts
 * Idempotente. Concede ao papel `nett_app` apenas o necessário para enfileirar e consumir.
 *
 * Pendente de aprovação do agente 01 (toca estrutura do banco — ver handoff de T-105).
 */
import { Client } from 'pg';
import { createBoss, PGBOSS_SCHEMA } from './boss';
import { ensureQueues } from './queues';

export async function setupJobs(migratorUrl: string, appRole = 'nett_app'): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(appRole)) throw new Error(`papel inválido: ${appRole}`);
  const boss = createBoss(migratorUrl, { migrate: true });
  await boss.start();
  await ensureQueues(boss);
  await boss.stop({ graceful: false, close: true });

  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    const s = `"${PGBOSS_SCHEMA}"`;
    await client.query(`GRANT USAGE ON SCHEMA ${s} TO ${appRole}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${appRole}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${appRole}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${s} TO ${appRole}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${appRole}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('setup.ts')) {
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!url) {
    console.error('[jobs:setup] DATABASE_URL_MIGRATOR não configurada');
    process.exit(1);
  }
  setupJobs(url)
    .then(() => console.log('[jobs:setup] schema pgboss e filas prontos'))
    .catch((e) => {
      console.error('[jobs:setup]', e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
