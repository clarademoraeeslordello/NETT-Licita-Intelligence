/**
 * Cria papéis e banco (uma vez por ambiente). Executar com superusuário:
 *   DATABASE_URL_SUPERUSER=... DB_NAME=nett_licita DB_APP_PASSWORD=... DB_MIGRATOR_PASSWORD=... npm run db:bootstrap
 * Idempotente. Senhas só via ambiente; nunca commitadas.
 */
import { Client } from 'pg';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} não configurada`);
  return v;
};
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(s)) throw new Error(`identificador inválido: ${s}`);
  return `"${s}"`;
};

async function main() {
  const superUrl = need('DATABASE_URL_SUPERUSER');
  const dbName = need('DB_NAME');
  const appPass = need('DB_APP_PASSWORD');
  const migPass = need('DB_MIGRATOR_PASSWORD');

  const admin = new Client({ connectionString: superUrl });
  await admin.connect();
  const lit = (s: string) => admin.escapeLiteral(s);
  for (const [role, pass] of [['nett_app', appPass], ['nett_migrator', migPass]] as const) {
    const exists = await admin.query('select 1 from pg_roles where rolname = $1', [role]);
    const verb = exists.rowCount ? 'ALTER' : 'CREATE';
    await admin.query(`${verb} ROLE ${ident(role)} LOGIN PASSWORD ${lit(pass)} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  }
  const db = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (!db.rowCount) await admin.query(`CREATE DATABASE ${ident(dbName)} OWNER nett_migrator`);
  await admin.end();

  const url = new URL(superUrl);
  url.pathname = `/${dbName}`;
  const target = new Client({ connectionString: url.toString() });
  await target.connect();
  await target.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await target.query('ALTER SCHEMA public OWNER TO nett_migrator');
  await target.query(`REVOKE CREATE ON DATABASE ${ident(dbName)} FROM PUBLIC`);
  await target.query(`GRANT CONNECT ON DATABASE ${ident(dbName)} TO nett_app`);
  await target.end();
  console.log(`[db:bootstrap] papéis nett_app/nett_migrator e banco ${dbName} prontos`);
}

main().catch((e) => {
  console.error('[db:bootstrap]', e instanceof Error ? e.message : e);
  process.exit(1);
});
