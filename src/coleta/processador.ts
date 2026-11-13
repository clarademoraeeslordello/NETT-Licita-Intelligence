/**
 * Processamento de uma oportunidade (job `oportunidade.processar`, orçamento padrão 50/h):
 * coleta documentos e itens no PNCP e publica `oportunidade.pronta_para_avaliacao` ao Agente 03.
 */
import type { EnriquecedorOportunidade } from '../conectores/tipos.js';
import { obterPool } from '../db/pool.js';
import { log } from '../observabilidade/log.js';
import { incrementar } from '../observabilidade/metricas.js';
import { salvarEnriquecimento } from '../repositorio/oportunidades.js';

export async function processarOportunidade(enriquecedor: EnriquecedorOportunidade, oportunidadeId: string): Promise<{ documentos: number; itens: number }> {
  const { rows } = await obterPool().query<{ numero_controle_pncp: string | null; cancelada: boolean }>(
    'SELECT numero_controle_pncp, cancelada FROM integracao.oportunidade WHERE id = $1',
    [oportunidadeId],
  );
  const op = rows[0];
  if (!op) throw new Error(`oportunidade ${oportunidadeId} não existe`);

  // Sem número de controle não há documentos no PNCP; a oportunidade segue com os dados da fonte.
  const [documentos, itens] = op.numero_controle_pncp
    ? await Promise.all([enriquecedor.documentos(op.numero_controle_pncp), enriquecedor.itens(op.numero_controle_pncp)])
    : [[], []];
  await salvarEnriquecimento(oportunidadeId, documentos, itens);
  incrementar('oportunidades_processadas_total');
  log('info', 'oportunidade.processada', { oportunidadeId, documentos: documentos.length, itens: itens.length });
  return { documentos: documentos.length, itens: itens.length };
}
