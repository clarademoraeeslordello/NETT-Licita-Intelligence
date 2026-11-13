/**
 * Worker: agenda coletas horárias, consome a fila persistente e respeita o orçamento de
 * processamento por hora. Encerramento gracioso em SIGTERM/SIGINT (termina o job atual).
 */
import { fileURLToPath } from 'node:url';
import { TIPO_COLETA, TIPO_TRELLO_BOARD, TIPO_TRELLO_CARD, agendar } from './agendador.js';
import { coletarFonte, TIPO_PROCESSAR } from './coleta/coletor.js';
import { processarOportunidade } from './coleta/processador.js';
import { carregarConfig, trelloConfigurado, type Config } from './config/index.js';
import { ClienteTrello } from './conectores/trello/cliente.js';
import { sincronizarBoard, sincronizarCard } from './conectores/trello/sincronizacao.js';
import { fecharPool } from './db/pool.js';
import { carregarDicionario } from './dicionario/dicionario.js';
import { concluir, falhar, recuperarExpirados, reservar, type Job } from './fila/fila.js';
import { criarConectores } from './fontes.js';
import { ErroHttp } from './http/cliente.js';
import { log } from './observabilidade/log.js';
import { incrementar } from './observabilidade/metricas.js';

export const MAX_PAGINAS_POR_EXECUCAO = Number(process.env.COLETA_MAX_PAGINAS ?? 300);

export function criarExecutor(config: Config) {
  const { conectores, pncp } = criarConectores(config);
  const trello = trelloConfigurado(config) ? new ClienteTrello(config.TRELLO_API_KEY, config.TRELLO_TOKEN) : null;

  return async function executar(job: Job): Promise<unknown> {
    switch (job.tipo) {
      case TIPO_COLETA: {
        const fonte = String(job.payload.fonte);
        const conector = conectores.get(fonte);
        if (!conector) throw new Error(`fonte desconhecida: ${fonte}`);
        const dicionario = await carregarDicionario(config.DICIONARIO_COMERCIAL_ARQUIVO);
        const janelaDias = fonte === 'comprasgov' ? Math.max(config.COLETA_JANELA_DIAS, 2) : config.COLETA_JANELA_DIAS;
        return coletarFonte(conector, dicionario, { janelaDias, maxPaginas: MAX_PAGINAS_POR_EXECUCAO });
      }
      case TIPO_PROCESSAR:
        return processarOportunidade(pncp, String(job.payload.oportunidadeId));
      case TIPO_TRELLO_BOARD:
        if (!trello) throw new Error('Trello não configurado');
        return sincronizarBoard(trello, config.TRELLO_BOARD_ID);
      case TIPO_TRELLO_CARD:
        if (!trello) throw new Error('Trello não configurado');
        return sincronizarCard(trello, String(job.payload.cardId));
      default:
        throw new Error(`tipo de job desconhecido: ${job.tipo}`);
    }
  };
}

export async function executarCiclo(config: Config, executar: (job: Job) => Promise<unknown>, limite = 5): Promise<number> {
  const jobs = await reservar({ limite, orcamentos: { [TIPO_PROCESSAR]: config.PROCESSAMENTO_LIMITE_HORA } });
  for (const job of jobs) {
    const inicio = Date.now();
    try {
      const resultado = await executar(job);
      await concluir(job.id);
      incrementar('fila_jobs_concluidos_total', { tipo: job.tipo });
      log('info', 'fila.job_concluido', { id: job.id, tipo: job.tipo, ms: Date.now() - inicio, resultado });
    } catch (erro) {
      const retentavel = !(erro instanceof ErroHttp) || erro.retentavel;
      const destino = await falhar(job, erro, { retentavel });
      incrementar('fila_jobs_falhos_total', { tipo: job.tipo, destino });
      log('error', 'fila.job_falhou', { id: job.id, tipo: job.tipo, tentativa: job.tentativas, destino, erro });
    }
  }
  return jobs.length;
}

async function principal() {
  const config = carregarConfig();
  const executar = criarExecutor(config);
  let parar = false;
  for (const sinal of ['SIGINT', 'SIGTERM'] as const) process.on(sinal, () => (parar = true));
  log('info', 'worker.inicio', { fontes: config.FONTES_ATIVAS, limiteHora: config.PROCESSAMENTO_LIMITE_HORA, trello: trelloConfigurado(config) });

  let ultimoAgendamento = 0;
  while (!parar) {
    try {
      if (Date.now() - ultimoAgendamento > 60_000) {
        const recuperados = await recuperarExpirados();
        const criados = await agendar(config);
        if (criados.length || recuperados) log('info', 'worker.agendamento', { criados, recuperados });
        ultimoAgendamento = Date.now();
      }
      const n = await executarCiclo(config, executar);
      if (n === 0) await new Promise((r) => setTimeout(r, 5_000));
    } catch (erro) {
      log('error', 'worker.ciclo_falhou', { erro });
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  log('info', 'worker.fim');
  await fecharPool();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void principal();
