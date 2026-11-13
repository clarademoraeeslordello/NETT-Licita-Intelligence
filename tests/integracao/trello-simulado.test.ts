/**
 * ATENÇÃO: Trello SIMULADO por servidor HTTP local com payloads no formato da documentação da API.
 * Valida apenas a lógica de persistência/histórico/somente-leitura. NÃO comprova a integração com o
 * board real da Nett, que depende de credenciais (pendente).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClienteTrello } from '../../src/conectores/trello/cliente.js';
import { sincronizarBoard, sincronizarCard } from '../../src/conectores/trello/sincronizacao.js';
import { ClienteHttp } from '../../src/http/cliente.js';
import { obterCardTrello } from '../../src/repositorio/consultas.js';
import { fecharPool, obterPool, prepararBanco } from './preparar.js';

const B = '5f0000000000000000000b01';
const L1 = '5f0000000000000000000a01';
const L2 = '5f0000000000000000000a02';
const C1 = '5f0000000000000000000c01';
const metodos: string[] = [];
let lista = L1;
let servidor: Server;
let cliente: ClienteTrello;

const card = () => ({
  id: C1, idBoard: B, idList: lista, name: 'Pregão 90012/2026 - Software', desc: 'PNCP 00394502000144-1-014968/2026',
  idLabels: ['lb1'], due: '2026-11-25T13:00:00.000Z', dueComplete: false, start: null, closed: false,
  shortUrl: 'https://trello.com/c/abc', dateLastActivity: '2026-11-13T10:00:00.000Z',
  attachments: [{ id: 'at1', name: 'edital.pdf', url: 'https://trello.com/1/cards/x/attachments/at1/download/edital.pdf', mimeType: 'application/pdf', bytes: 1000, date: '2026-11-12T10:00:00.000Z' }],
  checklists: [{ id: 'ck1', name: 'Habilitação', idCard: C1, checkItems: [{ id: 'i1', name: 'Certidões', state: 'incomplete', pos: 1 }] }],
});
const acoes = () => [
  { id: 'ac2', type: 'updateCard', date: '2026-11-13T10:00:00.000Z', idMemberCreator: 'm1', data: { board: { id: B }, card: { id: C1 }, listBefore: { id: L1 }, listAfter: { id: L2 } } },
  { id: 'ac1', type: 'commentCard', date: '2026-11-12T10:00:00.000Z', idMemberCreator: 'm1', data: { board: { id: B }, card: { id: C1 }, text: 'Verificar atestados' } },
];

beforeAll(async () => {
  await prepararBanco();
  servidor = createServer((req, res) => {
    metodos.push(req.method!);
    const u = new URL(req.url!, 'http://x');
    const p = u.pathname;
    const corpo =
      p === `/1/boards/${B}` ? { id: B, name: 'Comercial Nett', url: 'https://trello.com/b/x', closed: false, dateLastActivity: null }
      : p === `/1/boards/${B}/lists` ? [{ id: L1, name: 'Triagem', closed: false, pos: 1, idBoard: B }, { id: L2, name: 'Em análise', closed: false, pos: 2, idBoard: B }]
      : p === `/1/boards/${B}/labels` ? [{ id: 'lb1', name: 'Prioridade', color: 'red' }]
      : p === `/1/boards/${B}/cards` ? [card()]
      : p === `/1/boards/${B}/actions` || p === `/1/cards/${C1}/actions` ? acoes()
      : p === `/1/cards/${C1}` ? card()
      : null;
    res.writeHead(corpo ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(corpo ?? {}));
  }).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  const http = new ClienteHttp({ fonte: 'trello', baseUrl: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/1`, intervaloMinMs: 0, concorrencia: 2, timeoutMs: 5000, retentativas: 0 });
  cliente = new ClienteTrello('k', 't', http);
  // Vínculo card ↔ oportunidade existente.
  await obterPool().query(
    `INSERT INTO integracao.oportunidade (chave_canonica, numero_controle_pncp, objeto, orgao_nome, modalidade_nome, link_oficial, hash_conteudo, fonte_principal)
     VALUES ('pncp:00394502000144-1-014968/2026', '00394502000144-1-014968/2026', 'x', 'y', 'Dispensa', 'https://pncp.gov.br/app/editais/00394502000144/2026/14968', 'h', 'pncp')`,
  );
});
afterAll(async () => {
  servidor.close();
  await fecharPool();
});

describe('Trello (simulado)', () => {
  it('sincroniza board completo preservando IDs, histórico e vínculo com oportunidade', async () => {
    const r = await sincronizarBoard(cliente, B);
    expect(r).toEqual({ listas: 2, etiquetas: 1, cards: 1, cardsNovos: 1, cardsAtualizados: 0, acoesNovas: 2 });
    const c = (await obterCardTrello(C1))!;
    expect(c).toMatchObject({ id_externo: C1, lista_id: L1, prazo_concluido: false, versao: 1 });
    expect(c.etiquetas).toEqual([{ id: 'lb1', nome: 'Prioridade', cor: 'red' }]);
    expect(c.checklists[0].itens[0]).toMatchObject({ nome: 'Certidões', estado: 'incomplete' });
    expect(c.anexos).toHaveLength(1);
    expect(c.historico.map((h: { tipo: string }) => h.tipo)).toEqual(['commentCard', 'updateCard']);
    expect(c.historico[1]).toMatchObject({ lista_origem: L1, lista_destino: L2 });
    const v = await obterPool().query('SELECT oportunidade_id FROM integracao.trello_card_oportunidade WHERE card_id = $1', [C1]);
    expect(v.rows[0].oportunidade_id).toBeTruthy();
  });

  it('é idempotente e versiona alterações do card', async () => {
    expect(await sincronizarBoard(cliente, B)).toMatchObject({ cardsNovos: 0, cardsAtualizados: 0, acoesNovas: 0 });
    lista = L2;
    expect(await sincronizarCard(cliente, C1)).toBe('atualizado');
    expect((await obterCardTrello(C1))!).toMatchObject({ lista_id: L2, versao: 2 });
  });

  it('usa somente GET (board nunca é modificado)', () => {
    expect(new Set(metodos)).toEqual(new Set(['GET']));
  });
});
