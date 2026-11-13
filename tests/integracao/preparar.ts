import { fecharPool, obterPool } from '../../src/db/pool.js';
import { migrar } from '../../src/db/migrar.js';

export const URL_TESTE = process.env.DATABASE_URL_TESTE ?? 'postgres://postgres@localhost:5440/nett_licita_teste';

/** Recria o schema `integracao` no banco de TESTE (nunca no banco principal). */
export async function prepararBanco(): Promise<void> {
  if (!/teste/.test(URL_TESTE)) throw new Error('DATABASE_URL_TESTE precisa apontar para um banco de teste');
  await fecharPool();
  process.env.DATABASE_URL = URL_TESTE;
  const pool = obterPool(URL_TESTE);
  await pool.query('DROP SCHEMA IF EXISTS integracao CASCADE; DROP TABLE IF EXISTS public.integracao_migracoes;');
  await migrar();
}

export { fecharPool, obterPool };
