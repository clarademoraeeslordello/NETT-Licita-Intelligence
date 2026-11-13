/**
 * Agendamento horário idempotente: cada janela de N minutos gera no máximo um job por fonte,
 * graças à chave de deduplicação — vários workers podem rodar o agendador sem duplicar coletas.
 */
import { carregarConfig, trelloConfigurado, type Config } from './config/index.js';
import { enfileirarUnico } from './fila/fila.js';

export const TIPO_COLETA = 'coleta.listar';
export const TIPO_TRELLO_BOARD = 'trello.sincronizar_board';
export const TIPO_TRELLO_CARD = 'trello.sincronizar_card';

export function janelaAtual(agora: Date, intervaloMin: number): string {
  const bloco = Math.floor(agora.getTime() / (intervaloMin * 60_000));
  return new Date(bloco * intervaloMin * 60_000).toISOString();
}

export async function agendar(config: Config = carregarConfig(), agora = new Date()): Promise<string[]> {
  const janela = janelaAtual(agora, config.COLETA_INTERVALO_MIN);
  const criados: string[] = [];
  for (const fonte of config.FONTES_ATIVAS) {
    const id = await enfileirarUnico({ tipo: TIPO_COLETA, chaveDedupe: `${TIPO_COLETA}:${fonte}:${janela}`, payload: { fonte, janela }, prioridade: 10, maxTentativas: 3 });
    if (id) criados.push(`${fonte}@${janela}`);
  }
  if (trelloConfigurado(config)) {
    const id = await enfileirarUnico({ tipo: TIPO_TRELLO_BOARD, chaveDedupe: `${TIPO_TRELLO_BOARD}:${janela}`, payload: { janela }, prioridade: 20, maxTentativas: 3 });
    if (id) criados.push(`trello@${janela}`);
  }
  return criados;
}
