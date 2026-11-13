/**
 * Cliente Drizzle (servidor). Usa DATABASE_URL (papel nett_app, sem DDL).
 * Nunca importar em componente cliente.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

const g = globalThis as unknown as { __nettPool?: Pool; __nettDb?: Db };

export function getDb(): Db {
  if (g.__nettDb) return g.__nettDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada');
  g.__nettPool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  g.__nettDb = drizzle(g.__nettPool, { schema, casing: 'snake_case' });
  return g.__nettDb;
}

export async function closeDb(): Promise<void> {
  await g.__nettPool?.end();
  g.__nettPool = undefined;
  g.__nettDb = undefined;
}

export { schema };
