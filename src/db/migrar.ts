/** Aplica as migrations de src/db/migrations em ordem, registrando-as em integracao_migracoes. */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fecharPool, obterPool } from './pool.js';
import { log } from '../observabilidade/log.js';

const pasta = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrar(): Promise<string[]> {
  const pool = obterPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS public.integracao_migracoes (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
  const aplicadas = new Set((await pool.query<{ nome: string }>('SELECT nome FROM public.integracao_migracoes')).rows.map((r) => r.nome));
  const arquivos = (await readdir(pasta)).filter((f) => f.endsWith('.sql')).sort();
  const novas: string[] = [];
  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = await readFile(join(pasta, arquivo), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(sql);
      await cliente.query('INSERT INTO public.integracao_migracoes (nome) VALUES ($1)', [arquivo]);
      await cliente.query('COMMIT');
      novas.push(arquivo);
      log('info', 'db.migracao_aplicada', { arquivo });
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      cliente.release();
    }
  }
  return novas;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrar()
    .then((novas) => log('info', 'db.migracao_concluida', { novas }))
    .catch((erro) => {
      log('error', 'db.migracao_falhou', { erro });
      process.exitCode = 1;
    })
    .finally(fecharPool);
}
