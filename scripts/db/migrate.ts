/** Aplica db/migrations com o papel migrator (DATABASE_URL_MIGRATOR). */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!url) throw new Error('DATABASE_URL_MIGRATOR não configurada');
  const pool = new Pool({ connectionString: url, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: 'db/migrations' });
  await pool.end();
  console.log('[db:migrate] ok');
}

main().catch((e) => {
  console.error('[db:migrate]', e instanceof Error ? e.message : e);
  process.exit(1);
});
