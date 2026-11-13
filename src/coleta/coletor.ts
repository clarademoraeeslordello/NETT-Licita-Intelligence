/**
 * Orquestrador de coleta de uma fonte de licitações.
 *
 * Para cada partição (modalidade × dia) retoma da última página concluída (cursor persistido),
 * normaliza, aplica o dicionário comercial, persiste com deduplicação e enfileira o
 * processamento (documentos/itens + evento ao Agente 03) das oportunidades novas ou alteradas.
 *
 * Limites operacionais (páginas por execução, orçamento de 50 processamentos/hora) nunca
 * descartam dados: o cursor guarda onde parou e a fila guarda o que falta processar.
 * Dias já encerrados recebem uma releitura completa (sincronização de segurança) antes de
 * serem marcados como fechados.
 */
import type { ConectorLicitacoes, Particao } from '../conectores/tipos.js';
import { FonteIndisponivel } from '../conectores/tipos.js';
import type { Dicionario } from '../dicionario/dicionario.js';
import { obterPool } from '../db/pool.js';
import { enfileirar } from '../fila/fila.js';
import { log } from '../observabilidade/log.js';
import { incrementar } from '../observabilidade/metricas.js';
import { salvarOportunidade } from '../repositorio/oportunidades.js';
import { contadoresZerados, finalizarExecucao, iniciarExecucao, type Contadores } from './execucao.js';

export const TIPO_PROCESSAR = 'oportunidade.processar';

type Cursor = { pagina_concluida: number; total_paginas: number | null; fechado: boolean };

async function lerCursor(fonte: string, chave: string): Promise<Cursor | null> {
  const { rows } = await obterPool().query<Cursor>(
    'SELECT pagina_concluida, total_paginas, fechado FROM integracao.coleta_cursor WHERE fonte_id = $1 AND chave = $2',
    [fonte, chave],
  );
  return rows[0] ?? null;
}

async function gravarCursor(fonte: string, chave: string, pagina: number, totalPaginas: number, totalRegistros: number, fechado: boolean) {
  await obterPool().query(
    `INSERT INTO integracao.coleta_cursor (fonte_id, chave, pagina_concluida, total_paginas, total_registros, fechado)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (fonte_id, chave) DO UPDATE SET pagina_concluida = $3, total_paginas = $4, total_registros = $5, fechado = $6, atualizado_em = now()`,
    [fonte, chave, pagina, totalPaginas, totalRegistros, fechado],
  );
}

export type OpcoesColeta = { referencia?: Date; janelaDias: number; maxPaginas: number };

export type ResumoColeta = { execucaoId: number | null; status: 'sucesso' | 'parcial' | 'falha' | 'indisponivel'; contadores: Contadores; pendencias: string[] };

export async function coletarFonte(conector: ConectorLicitacoes, dicionario: Dicionario, opcoes: OpcoesColeta): Promise<ResumoColeta> {
  const fonte = conector.fonte;
  const motivo = conector.indisponibilidade();
  if (motivo) {
    log('warn', 'coleta.fonte_indisponivel', { fonte, motivo });
    incrementar('coleta_fonte_indisponivel_total', { fonte });
    return { execucaoId: null, status: 'indisponivel', contadores: contadoresZerados(), pendencias: [motivo] };
  }

  const execucaoId = await iniciarExecucao(fonte, 'listagem');
  const c = contadoresZerados();
  const pendencias: string[] = [];
  const erros: string[] = [];
  let orcamentoPaginas = opcoes.maxPaginas;
  const inicio = Date.now();
  log('info', 'coleta.inicio', { fonte, execucaoId, dicionario: dicionario.definicao.versao });

  for (const particao of conector.particoes(opcoes.referencia ?? new Date(), opcoes.janelaDias)) {
    if (orcamentoPaginas <= 0) {
      pendencias.push(particao.chave);
      continue;
    }
    try {
      orcamentoPaginas -= await coletarParticao(conector, dicionario, particao, c, orcamentoPaginas, pendencias);
    } catch (erro) {
      c.erros += 1;
      erros.push(`${particao.chave}: ${erro instanceof Error ? erro.message : String(erro)}`);
      log('error', 'coleta.particao_falhou', { fonte, particao: particao.chave, erro });
      if (erro instanceof FonteIndisponivel) break;
    }
  }

  const status = c.erros === 0 && pendencias.length === 0 ? 'sucesso' : c.paginas_lidas > 0 ? 'parcial' : 'falha';
  await finalizarExecucao(execucaoId, status, c, { pendencias, erros: erros.slice(0, 20), dicionario: dicionario.definicao.versao, dicionarioOficial: dicionario.definicao.oficial });
  for (const [k, v] of Object.entries(c)) incrementar(`coleta_${k}_total`, { fonte }, v);
  log('info', 'coleta.fim', { fonte, execucaoId, status, ms: Date.now() - inicio, ...c, pendencias: pendencias.length });
  return { execucaoId, status, contadores: c, pendencias };
}

/** Retorna o número de páginas consumidas. */
async function coletarParticao(
  conector: ConectorLicitacoes,
  dicionario: Dicionario,
  particao: Particao,
  c: Contadores,
  orcamento: number,
  pendencias: string[],
): Promise<number> {
  const fonte = conector.fonte;
  const principal = await lerCursor(fonte, particao.chave);
  if (principal?.fechado) return 0;

  // Dia corrente: retoma relendo a última página concluída (ela pode ter crescido).
  // Dia encerrado: releitura completa (sincronização de segurança) com cursor próprio,
  // também retomável; ao terminar, a partição é fechada.
  const seguranca = particao.diaFechado;
  const chaveCursor = seguranca ? `${particao.chave}#seguranca` : particao.chave;
  const cursor = seguranca ? await lerCursor(fonte, chaveCursor) : principal;
  let pagina = seguranca ? (cursor?.pagina_concluida ?? 0) + 1 : Math.max(1, cursor?.pagina_concluida ?? 1);
  let consumidas = 0;
  let totalPaginas = cursor?.total_paginas ?? 1;

  while (true) {
    if (consumidas >= orcamento) {
      pendencias.push(`${particao.chave}@${pagina}`);
      return consumidas;
    }
    const resultado = await conector.listarPagina(particao, pagina);
    consumidas += 1;
    c.paginas_lidas += 1;
    c.registros_lidos += resultado.registros.length + resultado.invalidos;
    c.erros += resultado.invalidos;
    totalPaginas = resultado.totalPaginas;

    for (const registro of resultado.registros) {
      const termos = dicionario.avaliar(registro.objeto, registro.informacaoComplementar);
      if (!termos.length) continue;
      c.registros_aderentes += 1;
      const salvo = await salvarOportunidade(registro, termos);
      if (salvo.resultado === 'nova') c.novas += 1;
      else if (salvo.resultado === 'atualizada') c.atualizadas += 1;
      else c.inalteradas += 1;
      if (salvo.resultado !== 'inalterada' && !registro.cancelada) {
        const id = await enfileirar({
          tipo: TIPO_PROCESSAR,
          chaveDedupe: `${TIPO_PROCESSAR}:${salvo.oportunidadeId}`,
          payload: { oportunidadeId: salvo.oportunidadeId, versao: salvo.versao, numeroControlePncp: registro.numeroControlePncp },
          // Novas antes de atualizações; encerramento mais próximo primeiro é tratado na API/UI.
          prioridade: salvo.resultado === 'nova' ? 50 : 80,
        });
        if (id) c.enfileiradas += 1;
      }
    }

    const ultima = pagina >= totalPaginas || resultado.registros.length + resultado.invalidos === 0;
    await gravarCursor(fonte, chaveCursor, pagina, totalPaginas, resultado.totalRegistros, ultima && seguranca);
    if (ultima) {
      if (seguranca) await gravarCursor(fonte, particao.chave, pagina, totalPaginas, resultado.totalRegistros, true);
      return consumidas;
    }
    pagina += 1;
  }
}
