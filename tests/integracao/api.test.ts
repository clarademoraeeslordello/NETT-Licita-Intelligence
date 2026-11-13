import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pncp from '../fixtures/pncp-atualizacao-amostra.json' with { type: 'json' };
import { criarServidor } from '../../src/api/servidor.js';
import { normalizarCompraPncp, type CompraPncpRaw } from '../../src/conectores/pncp/conector.js';
import { carregarConfig } from '../../src/config/index.js';
import { Oportunidade } from '../../src/contrato/oportunidade.js';
import { salvarOportunidade } from '../../src/repositorio/oportunidades.js';
import { fecharPool, obterPool, prepararBanco } from './preparar.js';

const TOKEN = 'token-de-teste-1234567890';
const SEGREDO = 'segredo-app-trello-teste';
const CALLBACK = 'https://exemplo.test/webhooks/trello';
let servidor: Server;
let base: string;
let id: string;

beforeAll(async () => {
  await prepararBanco();
  const config = carregarConfig({ ...process.env, API_TOKEN_INTERNO: TOKEN, TRELLO_APP_SECRET: SEGREDO, TRELLO_WEBHOOK_URL: CALLBACK });
  servidor = criarServidor(config).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  id = (await salvarOportunidade(normalizarCompraPncp((pncp.data as CompraPncpRaw[])[0]!)!, ['software'])).oportunidadeId;
});
afterAll(async () => {
  servidor.close();
  await fecharPool();
});

const get = (caminho: string, token: string | null = TOKEN) =>
  fetch(`${base}${caminho}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('API interna', () => {
  it('saúde sem autenticação; /v1 exige token', async () => {
    expect((await get('/saude', null)).status).toBe(200);
    expect((await get('/v1/oportunidades', null)).status).toBe(401);
    expect((await get('/v1/oportunidades', 'errado')).status).toBe(401);
  });

  it('lista e detalha no formato do contrato', async () => {
    const lista = await (await get('/v1/oportunidades?uf=' + normalizarCompraPncp((pncp.data as CompraPncpRaw[])[0]!)!.uf)).json();
    expect(lista.total).toBe(1);
    expect(lista.itens[0]).toMatchObject({ id, fontes: ['pncp'], termosDicionario: ['software'] });
    const det = await (await get(`/v1/oportunidades/${id}`)).json();
    expect(() => Oportunidade.parse(det)).not.toThrow();
    expect((await get('/v1/oportunidades/nao-uuid')).status).toBe(400);
    expect((await get('/v1/oportunidades/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('expõe eventos, fontes, fila, coletas e métricas', async () => {
    const ev = await (await get('/v1/eventos?apos=0')).json();
    expect(ev.eventos[0]).toMatchObject({ tipo: 'oportunidade.criada', agregadoId: id });
    const fontes = await (await get('/v1/fontes')).json();
    expect(fontes.fontes.find((f: { id: string }) => f.id === 'siga_rj').indisponibilidade).toMatch(/SIGA/);
    expect(fontes.fontes.find((f: { id: string }) => f.id === 'trello').indisponibilidade).toMatch(/credenciais/);
    expect((await get('/v1/fila')).status).toBe(200);
    expect((await get('/v1/coletas')).status).toBe(200);
    expect((await get('/v1/duplicatas')).status).toBe(200);
    expect(await (await get('/metricas')).text()).toContain('nett_api_requisicoes_total');
  });

  it('webhook Trello: HEAD ok, assinatura inválida rejeitada, válida enfileira sincronização do card', async () => {
    expect((await fetch(`${base}/webhooks/trello`, { method: 'HEAD' })).status).toBe(200);
    const corpo = JSON.stringify({ action: { id: 'a1', type: 'updateCard', date: '2026-11-13T00:00:00Z', data: { board: { id: 'b1' }, card: { id: 'c1' } } } });
    const ruim = await fetch(`${base}/webhooks/trello`, { method: 'POST', body: corpo, headers: { 'x-trello-webhook': 'xxx' } });
    expect(ruim.status).toBe(401);
    const assinatura = createHmac('sha1', SEGREDO).update(corpo + CALLBACK).digest('base64');
    const bom = await fetch(`${base}/webhooks/trello`, { method: 'POST', body: corpo, headers: { 'x-trello-webhook': assinatura } });
    expect(bom.status).toBe(200);
    const { rows } = await obterPool().query(`SELECT payload FROM integracao.fila_job WHERE tipo = 'trello.sincronizar_card'`);
    expect(rows).toEqual([{ payload: { cardId: 'c1' } }]);
    const rec = await obterPool().query('SELECT assinatura_ok FROM integracao.trello_webhook_recebido ORDER BY id');
    expect(rec.rows.map((r) => r.assinatura_ok)).toEqual([false, true]);
  });
});
