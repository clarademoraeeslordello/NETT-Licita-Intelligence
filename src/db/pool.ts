import pg from 'pg';

// numeric → number (valores monetários com até 4 casas cabem em double sem perda relevante para exibição).
pg.types.setTypeParser(1700, (valor) => (valor === null ? null : Number(valor)));
// int8 (bigserial/count) → number
pg.types.setTypeParser(20, (valor) => (valor === null ? null : Number(valor)));

let pool: pg.Pool | null = null;

export function obterPool(url = process.env.DATABASE_URL): pg.Pool {
  if (pool) return pool;
  if (!url) throw new Error('DATABASE_URL não definido');
  pool = new pg.Pool({ connectionString: url, max: 10 });
  return pool;
}

export async function fecharPool(): Promise<void> {
  await pool?.end();
  pool = null;
}

export type Executor = Pick<pg.Pool, 'query'> | pg.PoolClient;

export async function emTransacao<T>(fn: (cliente: pg.PoolClient) => Promise<T>): Promise<T> {
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}
