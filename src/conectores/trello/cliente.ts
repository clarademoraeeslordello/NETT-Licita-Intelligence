/**
 * Cliente Trello SOMENTE LEITURA.
 * - Usa exclusivamente GET (ClienteHttp não expõe outros métodos): o board não é modificado.
 * - Credenciais vão no cabeçalho Authorization (não na URL) para não vazarem em logs.
 * - Limite oficial: 100 req/10 s por token; usamos no máximo ~5 req/s.
 */
import { ClienteHttp } from '../../http/cliente.js';

export const TRELLO_BASE = 'https://api.trello.com/1';

export type TrelloLabel = { id: string; name: string; color: string | null };
export type TrelloList = { id: string; name: string; closed: boolean; pos: number; idBoard: string };
export type TrelloCheckItem = { id: string; name: string; state: 'complete' | 'incomplete'; pos: number; due?: string | null };
export type TrelloChecklist = { id: string; name: string; idCard: string; checkItems: TrelloCheckItem[] };
export type TrelloAttachment = { id: string; name: string | null; url: string | null; mimeType: string | null; bytes: number | null; date: string | null };
export type TrelloCard = {
  id: string;
  idBoard: string;
  idList: string;
  name: string;
  desc: string;
  idLabels: string[];
  due: string | null;
  dueComplete: boolean;
  start: string | null;
  closed: boolean;
  shortUrl?: string;
  url?: string;
  dateLastActivity: string | null;
  attachments?: TrelloAttachment[];
  checklists?: TrelloChecklist[];
};
export type TrelloAction = {
  id: string;
  type: string;
  date: string;
  idMemberCreator?: string;
  data: {
    text?: string;
    card?: { id: string; name?: string };
    board?: { id: string };
    listBefore?: { id: string; name?: string };
    listAfter?: { id: string; name?: string };
    list?: { id: string; name?: string };
    old?: Record<string, unknown>;
    [k: string]: unknown;
  };
};
export type TrelloBoard = { id: string; name: string; url: string; closed: boolean; dateLastActivity: string | null };

/** Tipos de ação relevantes para histórico (comentários, movimentações, alterações). */
export const FILTRO_ACOES = [
  'commentCard',
  'updateComment',
  'deleteComment',
  'createCard',
  'copyCard',
  'updateCard',
  'deleteCard',
  'moveCardToBoard',
  'moveCardFromBoard',
  'convertToCardFromCheckItem',
  'addAttachmentToCard',
  'deleteAttachmentFromCard',
  'addChecklistToCard',
  'removeChecklistFromCard',
  'updateCheckItemStateOnCard',
  'addLabelToCard',
  'removeLabelFromCard',
  'addMemberToCard',
  'removeMemberFromCard',
  'createList',
  'updateList',
].join(',');

export class ClienteTrello {
  private readonly http: ClienteHttp;

  constructor(chave: string, token: string, http?: ClienteHttp) {
    this.http =
      http ??
      new ClienteHttp({
        fonte: 'trello',
        baseUrl: TRELLO_BASE,
        intervaloMinMs: 200,
        concorrencia: 2,
        timeoutMs: 30_000,
        retentativas: 3,
        cabecalhos: { authorization: `OAuth oauth_consumer_key="${chave}", oauth_token="${token}"` },
      });
  }

  board(id: string) {
    return this.http.get<TrelloBoard>(`/boards/${id}`, { params: { fields: 'name,url,closed,dateLastActivity' } });
  }
  listas(boardId: string) {
    return this.http.get<TrelloList[]>(`/boards/${boardId}/lists`, { params: { filter: 'all', fields: 'name,closed,pos,idBoard' } });
  }
  etiquetas(boardId: string) {
    return this.http.get<TrelloLabel[]>(`/boards/${boardId}/labels`, { params: { fields: 'name,color', limit: 1000 } });
  }
  cards(boardId: string) {
    return this.http.get<TrelloCard[]>(`/boards/${boardId}/cards`, {
      params: {
        filter: 'all',
        fields: 'idBoard,idList,name,desc,idLabels,due,dueComplete,start,closed,shortUrl,url,dateLastActivity',
        attachments: 'true',
        attachment_fields: 'name,url,mimeType,bytes,date',
        checklists: 'all',
        checklist_fields: 'name,idCard',
      },
    });
  }
  card(cardId: string) {
    return this.http.get<TrelloCard>(`/cards/${cardId}`, {
      params: {
        fields: 'idBoard,idList,name,desc,idLabels,due,dueComplete,start,closed,shortUrl,url,dateLastActivity',
        attachments: 'true',
        attachment_fields: 'name,url,mimeType,bytes,date',
        checklists: 'all',
        checklist_fields: 'name,idCard',
      },
    });
  }

  /** Ações do board desde `desde` (ISO), paginando para trás com `before`. */
  async acoesBoard(boardId: string, desde: string | null): Promise<TrelloAction[]> {
    const todas: TrelloAction[] = [];
    let antes: string | undefined;
    for (let i = 0; i < 200; i += 1) {
      const pagina = await this.http.get<TrelloAction[]>(`/boards/${boardId}/actions`, {
        params: { filter: FILTRO_ACOES, limit: 1000, since: desde ?? undefined, before: antes, memberCreator: 'false', member: 'false' },
      });
      todas.push(...pagina);
      if (pagina.length < 1000) break;
      antes = pagina[pagina.length - 1]!.id;
    }
    return todas;
  }

  acoesCard(cardId: string) {
    return this.http.get<TrelloAction[]>(`/cards/${cardId}/actions`, { params: { filter: FILTRO_ACOES, limit: 1000, memberCreator: 'false', member: 'false' } });
  }
}
