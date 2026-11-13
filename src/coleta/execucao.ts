/** Registro durável de cada execução de coleta (monitoramento real, consultável em /v1/coletas). */
import { obterPool } from '../db/pool.js';
import type { FonteId } from '../contrato/oportunidade.js';

export type Contadores = {
  paginas_lidas: number;
  registros_lidos: number;
  registros_aderentes: number;
  novas: number;
  atualizadas: number;
  inalteradas: number;
  enfileiradas: number;
  erros: number;
};

export const contadoresZerados = (): Contadores => ({
  paginas_lidas: 0,
  registros_lidos: 0,
  registros_aderentes: 0,
  novas: 0,
  atualizadas: 0,
  inalteradas: 0,
  enfileiradas: 0,
  erros: 0,
});

export async function iniciarExecucao(fonte: FonteId, tipo: string): Promise<number> {
  const { rows } = await obterPool().query<{ id: number }>(
    'INSERT INTO integracao.execucao_coleta (fonte_id, tipo) VALUES ($1, $2) RETURNING id',
    [fonte, tipo],
  );
  return rows[0]!.id;
}

export async function finalizarExecucao(
  id: number,
  status: 'sucesso' | 'parcial' | 'falha',
  c: Contadores,
  detalhe: Record<string, unknown>,
): Promise<void> {
  await obterPool().query(
    `UPDATE integracao.execucao_coleta
        SET status = $2, finalizada_em = now(), duracao_ms = (extract(epoch FROM now() - iniciada_em) * 1000)::int,
            paginas_lidas = $3, registros_lidos = $4, registros_aderentes = $5, novas = $6, atualizadas = $7,
            inalteradas = $8, enfileiradas = $9, erros = $10, detalhe = $11
      WHERE id = $1`,
    [id, status, c.paginas_lidas, c.registros_lidos, c.registros_aderentes, c.novas, c.atualizadas, c.inalteradas, c.enfileiradas, c.erros, detalhe],
  );
}
