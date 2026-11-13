/**
 * Sincronização Trello → schema integracao (espelho somente leitura).
 * - Completa (sincronização de segurança, horária): board, listas, etiquetas, cards, checklists,
 *   anexos e ações novas desde a última ação registrada.
 * - Por card (disparada por webhook): card + checklists + anexos + ações do card.
 * IDs externos do Trello são as chaves primárias; nada é apagado (cards removidos ficam como estão
 * e o evento deleteCard fica no histórico).
 */
import type pg from 'pg';
import { emTransacao, obterPool } from '../../db/pool.js';
import { hashEstavel } from '../../dedupe/dedupe.js';
import { log } from '../../observabilidade/log.js';
import { registrarEvento } from '../../repositorio/oportunidades.js';
import type { ClienteTrello, TrelloAction, TrelloCard } from './cliente.js';

const RE_CONTROLE = /\b(\d{14})-(\d)-(\d{6})\/(\d{4})\b/g;
const RE_LINK = /pncp\.gov\.br\/app\/editais\/(\d{14})\/(\d{4})\/(\d{1,7})/g;

/** Números de controle PNCP citados no card (texto ou links de anexos). */
export function controlesPncpNoCard(card: Pick<TrelloCard, 'name' | 'desc' | 'attachments'>): string[] {
  const texto = [card.name, card.desc, ...(card.attachments ?? []).map((a) => `${a.name ?? ''} ${a.url ?? ''}`)].join('\n');
  const achados = new Set<string>();
  for (const m of texto.matchAll(RE_CONTROLE)) achados.add(`${m[1]}-${m[2]}-${m[3]}/${m[4]}`);
  for (const m of texto.matchAll(RE_LINK)) achados.add(`${m[1]}-1-${m[3]!.padStart(6, '0')}/${m[2]}`);
  return [...achados];
}

export function resumoAcao(a: TrelloAction) {
  return {
    cardId: a.data.card?.id ?? null,
    texto: typeof a.data.text === 'string' ? a.data.text : null,
    listaOrigem: a.data.listBefore?.id ?? null,
    listaDestino: a.data.listAfter?.id ?? null,
  };
}

export async function salvarAcoes(db: pg.PoolClient | pg.Pool, boardId: string, acoes: TrelloAction[], origem: 'sincronizacao' | 'webhook'): Promise<number> {
  let novas = 0;
  for (const a of acoes) {
    const r = resumoAcao(a);
    const { rows } = await db.query<{ inserida: boolean }>(
      `INSERT INTO integracao.trello_acao (id_externo, board_id, card_id, tipo, ocorrida_em, membro_id, texto, lista_origem, lista_destino, dados, origem_captura)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id_externo) DO UPDATE SET texto = COALESCE(EXCLUDED.texto, integracao.trello_acao.texto)
       RETURNING (xmax = 0) AS inserida`,
      [a.id, boardId, r.cardId, a.type, a.date, a.idMemberCreator ?? null, r.texto, r.listaOrigem, r.listaDestino, a.data, origem],
    );
    if (rows[0]?.inserida) novas += 1;
  }
  return novas;
}

export async function salvarCard(db: pg.PoolClient, card: TrelloCard): Promise<'novo' | 'atualizado' | 'inalterado'> {
  const conteudo = {
    idList: card.idList,
    name: card.name,
    desc: card.desc,
    idLabels: [...card.idLabels].sort(),
    due: card.due,
    dueComplete: card.dueComplete,
    start: card.start,
    closed: card.closed,
    checklists: (card.checklists ?? []).map((c) => ({ id: c.id, name: c.name, itens: c.checkItems.map((i) => [i.id, i.name, i.state]) })),
    anexos: (card.attachments ?? []).map((a) => a.id).sort(),
  };
  const hash = hashEstavel(conteudo);
  const atual = (await db.query<{ hash_conteudo: string }>('SELECT hash_conteudo FROM integracao.trello_card WHERE id_externo = $1', [card.id])).rows[0];
  const { checklists, attachments, ...payload } = card;

  await db.query(
    `INSERT INTO integracao.trello_card (id_externo, board_id, lista_id, nome, descricao, etiquetas, prazo, prazo_concluido, inicio, arquivado, url, ultima_atividade, hash_conteudo, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id_externo) DO UPDATE SET
       lista_id = EXCLUDED.lista_id, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao, etiquetas = EXCLUDED.etiquetas,
       prazo = EXCLUDED.prazo, prazo_concluido = EXCLUDED.prazo_concluido, inicio = EXCLUDED.inicio, arquivado = EXCLUDED.arquivado,
       url = EXCLUDED.url, ultima_atividade = EXCLUDED.ultima_atividade, payload = EXCLUDED.payload, sincronizado_em = now(),
       versao = integracao.trello_card.versao + CASE WHEN integracao.trello_card.hash_conteudo = EXCLUDED.hash_conteudo THEN 0 ELSE 1 END,
       hash_conteudo = EXCLUDED.hash_conteudo`,
    [card.id, card.idBoard, card.idList, card.name, card.desc ?? '', card.idLabels, card.due, card.dueComplete, card.start, card.closed, card.shortUrl ?? card.url ?? null, card.dateLastActivity, hash, payload],
  );
  for (const c of checklists ?? []) {
    await db.query(
      `INSERT INTO integracao.trello_checklist (id_externo, card_id, nome, itens) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id_externo) DO UPDATE SET nome = EXCLUDED.nome, itens = EXCLUDED.itens, sincronizado_em = now()`,
      [c.id, card.id, c.name, JSON.stringify(c.checkItems.map((i) => ({ id: i.id, nome: i.name, estado: i.state, posicao: i.pos, prazo: i.due ?? null })))],
    );
  }
  for (const a of attachments ?? []) {
    await db.query(
      `INSERT INTO integracao.trello_anexo (id_externo, card_id, nome, url, mime, bytes, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id_externo) DO UPDATE SET nome = EXCLUDED.nome, url = EXCLUDED.url, sincronizado_em = now()`,
      [a.id, card.id, a.name, a.url, a.mimeType, a.bytes, a.date],
    );
  }
  for (const controle of controlesPncpNoCard(card)) {
    await db.query(
      `INSERT INTO integracao.trello_card_oportunidade (card_id, numero_controle_pncp, oportunidade_id)
       VALUES ($1, $2, (SELECT id FROM integracao.oportunidade WHERE numero_controle_pncp = $2 LIMIT 1))
       ON CONFLICT (card_id, numero_controle_pncp) DO UPDATE SET oportunidade_id = COALESCE(EXCLUDED.oportunidade_id, integracao.trello_card_oportunidade.oportunidade_id)`,
      [card.id, controle],
    );
  }
  const resultado = !atual ? 'novo' : atual.hash_conteudo === hash ? 'inalterado' : 'atualizado';
  if (resultado !== 'inalterado') await registrarEvento(db, 'trello.card_atualizado', card.id, { resultado, lista: card.idList });
  return resultado;
}

export type ResumoTrello = { listas: number; etiquetas: number; cards: number; cardsNovos: number; cardsAtualizados: number; acoesNovas: number };

export async function sincronizarBoard(cliente: ClienteTrello, boardId: string): Promise<ResumoTrello> {
  const board = await cliente.board(boardId);
  const [listas, etiquetas, cards] = await Promise.all([cliente.listas(boardId), cliente.etiquetas(boardId), cliente.cards(boardId)]);
  const ultima = (await obterPool().query<{ max: Date | null }>('SELECT max(ocorrida_em) AS max FROM integracao.trello_acao WHERE board_id = $1', [board.id])).rows[0]?.max;
  // Margem de 1 h para não perder ações com relógio deslocado; duplicatas são ignoradas pelo id.
  const desde = ultima ? new Date(ultima.getTime() - 3_600_000).toISOString() : null;
  const acoes = await cliente.acoesBoard(boardId, desde);

  return emTransacao(async (db) => {
    await db.query(
      `INSERT INTO integracao.trello_board (id_externo, nome, url, payload) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id_externo) DO UPDATE SET nome = EXCLUDED.nome, url = EXCLUDED.url, payload = EXCLUDED.payload, sincronizado_em = now()`,
      [board.id, board.name, board.url, board],
    );
    for (const l of listas) {
      await db.query(
        `INSERT INTO integracao.trello_lista (id_externo, board_id, nome, posicao, arquivada, payload) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id_externo) DO UPDATE SET nome = EXCLUDED.nome, posicao = EXCLUDED.posicao, arquivada = EXCLUDED.arquivada, payload = EXCLUDED.payload, sincronizado_em = now()`,
        [l.id, board.id, l.name, l.pos, l.closed, l],
      );
    }
    for (const e of etiquetas) {
      await db.query(
        `INSERT INTO integracao.trello_etiqueta (id_externo, board_id, nome, cor) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id_externo) DO UPDATE SET nome = EXCLUDED.nome, cor = EXCLUDED.cor, sincronizado_em = now()`,
        [e.id, board.id, e.name, e.color],
      );
    }
    let cardsNovos = 0;
    let cardsAtualizados = 0;
    for (const card of cards) {
      const r = await salvarCard(db, card);
      if (r === 'novo') cardsNovos += 1;
      if (r === 'atualizado') cardsAtualizados += 1;
    }
    const acoesNovas = await salvarAcoes(db, board.id, acoes, 'sincronizacao');
    const resumo = { listas: listas.length, etiquetas: etiquetas.length, cards: cards.length, cardsNovos, cardsAtualizados, acoesNovas };
    log('info', 'trello.sincronizacao_board', { boardId: board.id, ...resumo });
    return resumo;
  });
}

export async function sincronizarCard(cliente: ClienteTrello, cardId: string): Promise<'novo' | 'atualizado' | 'inalterado'> {
  const [card, acoes] = await Promise.all([cliente.card(cardId), cliente.acoesCard(cardId)]);
  return emTransacao(async (db) => {
    const existeBoard = (await db.query('SELECT 1 FROM integracao.trello_board WHERE id_externo = $1', [card.idBoard])).rowCount;
    if (!existeBoard) throw new Error(`board ${card.idBoard} ainda não sincronizado; execute a sincronização completa primeiro`);
    const r = await salvarCard(db, card);
    await salvarAcoes(db, card.idBoard, acoes, 'sincronizacao');
    return r;
  });
}
