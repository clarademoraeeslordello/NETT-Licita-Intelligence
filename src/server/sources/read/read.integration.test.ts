/**
 * T-204 — integração com Postgres real (banco descartável migrado).
 *   DATABASE_URL_TEST (nett_app)   npm run test:read:integration
 * As oportunidades aqui são inseridas diretamente para controlar status e datas; isolamento por
 * `sourceKey` único por execução (o banco de teste é reutilizado).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { opportunityListQuery, opportunityPage, opportunityView, pricePage, publicDocumentPage, sourcePage, opportunityItemPage, priceQuery } from '@/contracts/api';
import type { Db } from '../../db';
import * as s from '../../db/schema';
import { InvalidCursor } from './cursor';
import { getOpportunity, listItems, listOpportunities, listPublicDocuments, opportunityExists } from './opportunities';
import { listPrices } from './prices';
import { listSources } from './sources';
import { effectiveStatus, effectiveStatusCondition, type EffectiveStatus } from './status';
import { requestSync } from './sync-request';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST não configurada');
const pool = new Pool({ connectionString: url, max: 4 });
const db = drizzle(pool, { schema: s, casing: 'snake_case' }) as unknown as Db;

const run = Date.now().toString(36);
const KEY = `t204_${run}`.slice(0, 40);
const NOW = new Date('2026-11-16T15:00:00.000Z');
const q = (params: string) => opportunityListQuery.parse(Object.fromEntries(new URLSearchParams(`sourceKey=${KEY}&${params}`)));

let sourceId: string;
let companyId: string;
const ids: Record<string, string> = {};

const base = (n: string, over: Partial<typeof s.opportunities.$inferInsert>): typeof s.opportunities.$inferInsert => ({
  canonicalKey: `t204_${run}:${n}`,
  primarySourceId: sourceId,
  title: `Edital ${n}`,
  objectDescription: `Objeto ${n} ${run}`,
  agencyName: `Órgão ${n}`,
  sphere: 'municipal',
  status: 'published',
  url: `https://pncp.gov.br/app/editais/00000000000000/2026/${n.length}`,
  contentHash: 'a'.repeat(64),
  ...over,
});

before(async () => {
  [{ id: sourceId }] = await db.insert(s.sources).values({ key: KEY, name: 'Teste T-204', kind: 'api', rateLimit: { requestsPerMinute: 10, maxConcurrency: 1 } }).returning({ id: s.sources.id });
  [{ id: companyId }] = await db.insert(s.companies).values({ legalName: `Empresa ${run}`, cnpj: String(Date.now()).slice(-10).padStart(14, '5'), size: 'ME' }).returning({ id: s.companies.id });
  const d = (iso: string) => new Date(iso);
  const rows: Array<[string, Partial<typeof s.opportunities.$inferInsert>]> = [
    ['aberta1', { proposalsCloseAt: d('2026-11-20T12:00:00Z'), publishedAt: d('2026-11-10T12:00:00Z'), uf: 'RJ', modalityCode: 6, estimatedValue: '1000.0000', title: 'Aquisição de software de gestão' }],
    ['aberta2', { proposalsCloseAt: d('2026-11-18T12:00:00Z'), publishedAt: d('2026-11-12T12:00:00Z'), uf: 'SP', modalityCode: 8, estimatedValue: '50000.5000' }],
    ['limite', { proposalsCloseAt: d('2026-11-16T15:00:00Z'), publishedAt: d('2026-11-11T12:00:00Z'), uf: 'RJ', modalityCode: 6 }], // = now → encerrada
    ['encerrada', { proposalsCloseAt: d('2026-11-01T12:00:00Z'), publishedAt: d('2026-10-20T12:00:00Z'), uf: 'RJ', modalityCode: 4, estimatedValue: '700.0000' }],
    ['semdata', { proposalsCloseAt: null, publishedAt: null, uf: null, modalityCode: null }],
    ['homologada', { status: 'awarded', proposalsCloseAt: d('2026-12-30T12:00:00Z'), publishedAt: d('2026-11-05T12:00:00Z'), uf: 'RJ', modalityCode: 6, awardedValue: '900.0000' }],
    ['cancelada', { status: 'cancelled', proposalsCloseAt: d('2026-12-30T12:00:00Z'), publishedAt: d('2026-11-04T12:00:00Z') }],
    ['suspensa', { status: 'suspended', proposalsCloseAt: null, publishedAt: d('2026-11-03T12:00:00Z') }],
    ['desconhecida', { status: 'unknown', proposalsCloseAt: null, publishedAt: d('2026-11-02T12:00:00Z') }],
    ['empate1', { proposalsCloseAt: d('2026-11-25T12:00:00Z'), publishedAt: d('2026-11-09T12:00:00Z') }],
    ['empate2', { proposalsCloseAt: d('2026-11-25T12:00:00Z'), publishedAt: d('2026-11-09T12:00:00Z') }],
  ];
  for (const [n, over] of rows) {
    const [r] = await db.insert(s.opportunities).values(base(n, over)).returning({ id: s.opportunities.id });
    ids[n] = r!.id;
  }
});

after(async () => {
  await pool.end();
});

test('effectiveStatus (JS) e effectiveStatusCondition (SQL) concordam em todos os casos e status', async () => {
  const all: EffectiveStatus[] = ['published', 'receiving_proposals', 'closed', 'awarded', 'cancelled', 'suspended', 'unknown'];
  const todos = await db.select().from(s.opportunities).where(eq(s.opportunities.primarySourceId, sourceId));
  assert.equal(todos.length, 11);
  for (const status of all) {
    const rows = await db.select({ id: s.opportunities.id }).from(s.opportunities).where(sql`${s.opportunities.primarySourceId} = ${sourceId} and ${effectiveStatusCondition([status], NOW)}`);
    const esperados = todos.filter((o) => effectiveStatus(o, NOW) === status).map((o) => o.id).sort();
    assert.deepEqual(rows.map((r) => r.id).sort(), esperados, `status efetivo ${status}`);
  }
  // Cada oportunidade casa com exatamente UMA situação efetiva.
  for (const o of todos) {
    const hits = [];
    for (const status of all) {
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.opportunities).where(sql`${s.opportunities.id} = ${o.id} and ${effectiveStatusCondition([status], NOW)}`);
      if (r!.n) hits.push(status);
    }
    assert.deepEqual(hits, [effectiveStatus(o, NOW)], o.canonicalKey);
  }
  assert.equal(effectiveStatus(todos.find((o) => o.id === ids.limite)!, NOW), 'closed');
});

test('listagem: filtro por situação efetiva e respostas válidas no contrato', async () => {
  const abertas = await listOpportunities(db, q('status=receiving_proposals&sort=close_asc'), NOW);
  // Por encerramento crescente; empate (empate1/empate2) desempata por id crescente.
  assert.deepEqual(abertas.items.map((i) => i.id), [ids.aberta2, ids.aberta1, ...[ids.empate1!, ids.empate2!].sort()]);
  assert.ok(abertas.items.every((i) => i.effectiveStatus === 'receiving_proposals' && i.sourceKey === KEY));
  const encerradas = await listOpportunities(db, q('status=closed'), NOW);
  assert.deepEqual(encerradas.items.map((i) => i.id).sort(), [ids.limite, ids.encerrada].sort());
  const varias = await listOpportunities(db, q('status=awarded,cancelled'), NOW);
  assert.deepEqual(varias.items.map((i) => i.id).sort(), [ids.homologada, ids.cancelada].sort());
  assert.doesNotThrow(() => opportunityPage.parse(abertas));
  assert.doesNotThrow(() => opportunityPage.parse(encerradas));
});

test('listagem: filtros de UF, modalidade, valor, busca, janela de encerramento', async () => {
  const ids_ = async (p: string) => (await listOpportunities(db, q(p), NOW)).items.map((i) => i.id).sort();
  assert.deepEqual(await ids_('ufs=SP'), [ids.aberta2]);
  assert.deepEqual(await ids_('ufs=SP,RJ&modalities=8'), [ids.aberta2]);
  assert.deepEqual(await ids_('modalities=4'), [ids.encerrada]);
  assert.deepEqual(await ids_('minValue=1000&maxValue=60000'), [ids.aberta1, ids.aberta2].sort());
  assert.deepEqual(await ids_('minValue=50000.5'), [ids.aberta2], 'comparação numérica exata');
  assert.deepEqual(await ids_('maxValue=700'), [ids.encerrada], 'valor desconhecido fica fora quando há limite');
  assert.deepEqual(await ids_('q=software'), [ids.aberta1]);
  assert.deepEqual(await ids_('q=%25%25'), [], 'curinga é literal');
  assert.deepEqual(await ids_('q=%C3%93RG%C3%83O%20ABERTA2'), [ids.aberta2], 'insensível a caixa (ILIKE)');
  assert.deepEqual(await ids_('closesFrom=2026-11-18&closesTo=2026-11-20'), [ids.aberta1, ids.aberta2].sort(), 'data pura inclui o dia inteiro em Brasília');
  assert.deepEqual(await ids_('closesFrom=2026-11-20&closesTo=2026-11-20'), [ids.aberta1], 'um único dia');
  assert.deepEqual(await ids_('closesFrom=2026-11-20T15:00:00Z'), [ids.empate1, ids.empate2, ids.homologada, ids.cancelada].sort(), 'instante exato');
  const outraFonte = opportunityListQuery.parse({ sourceKey: 'nao_existe_jamais' });
  assert.equal((await listOpportunities(db, outraFonte, NOW)).items.length, 0);
});

test('paginação por cursor: percorre tudo sem repetir nem pular, nas duas ordenações, com empates', async () => {
  for (const sort of ['published_desc', 'close_asc'] as const) {
    const vistos: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const p = await listOpportunities(db, q(`sort=${sort}&limit=3${cursor ? `&cursor=${cursor}` : ''}`), NOW);
      vistos.push(...p.items.map((i) => i.id));
      cursor = p.nextCursor ?? undefined;
      paginas += 1;
    } while (cursor && paginas < 10);
    assert.equal(paginas, 4, sort);
    assert.equal(new Set(vistos).size, 11, `${sort}: sem repetição`);
    const todos = await listOpportunities(db, q(`sort=${sort}&limit=100`), NOW);
    assert.deepEqual(vistos, todos.items.map((i) => i.id), `${sort}: mesma ordem`);
    assert.equal(todos.nextCursor, null);
  }
  const porPublicacao = (await listOpportunities(db, q('sort=published_desc&limit=100'), NOW)).items.map((i) => i.id);
  assert.equal(porPublicacao[0], ids.aberta2, 'mais recente primeiro');
  assert.equal(porPublicacao.at(-1), ids.semdata, 'sem data de publicação por último');
  const porEncerramento = (await listOpportunities(db, q('sort=close_asc&limit=100'), NOW)).items.map((i) => i.id);
  const semEncerramento = [ids.semdata!, ids.suspensa!, ids.desconhecida!];
  assert.deepEqual(porEncerramento.slice(-3).sort(), semEncerramento.sort(), 'sem encerramento por último');
});

test('cursor inválido ou de outra ordenação lança InvalidCursor', async () => {
  const p = await listOpportunities(db, q('limit=2'), NOW);
  assert.ok(p.nextCursor);
  await assert.rejects(listOpportunities(db, q(`sort=close_asc&cursor=${p.nextCursor}`), NOW), InvalidCursor);
  await assert.rejects(listOpportunities(db, q('cursor=lixo'), NOW), InvalidCursor);
});

test('detalhe, itens e documentos (só públicos, sem chave de storage)', async () => {
  const v = await getOpportunity(db, ids.aberta1!, NOW);
  assert.ok(v);
  assert.doesNotThrow(() => opportunityView.parse(v));
  assert.equal(v.effectiveStatus, 'receiving_proposals');
  assert.equal(v.estimatedValue, '1000.0000');
  assert.equal(await getOpportunity(db, '00000000-0000-4000-8000-000000000000'), null);
  assert.equal(await opportunityExists(db, ids.aberta1!), true);

  for (let n = 1; n <= 5; n++) await db.insert(s.opportunityItems).values({ opportunityId: ids.aberta1!, number: n, description: `Item ${n}`, kind: 'material', quantity: '2', unit: 'UN' });
  const p1 = await listItems(db, ids.aberta1!, 2);
  assert.deepEqual(p1.items.map((i) => i.number), [1, 2]);
  assert.equal(p1.nextCursor, '2');
  const p3 = await listItems(db, ids.aberta1!, 2, '4');
  assert.deepEqual(p3.items.map((i) => i.number), [5]);
  assert.equal(p3.nextCursor, null);
  assert.doesNotThrow(() => opportunityItemPage.parse(p1));
  await assert.rejects(listItems(db, ids.aberta1!, 2, '-1'), InvalidCursor);
  await assert.rejects(listItems(db, ids.aberta1!, 2, 'x'), InvalidCursor);

  await db.insert(s.documents).values([
    { opportunityId: ids.aberta1!, companyId: null, kind: 'tender_notice', origin: 'source', title: 'Edital', sourceUrl: 'https://pncp.gov.br/pncp-api/v1/x/1', mimeType: 'application/pdf' },
    { opportunityId: ids.aberta1!, companyId: null, kind: 'annex', origin: 'source', title: 'Baixado', sourceUrl: 'https://pncp.gov.br/pncp-api/v1/x/2', mimeType: 'application/pdf', storageKey: `public/${ids.aberta1}/${'b'.repeat(64)}.pdf`, sha256: 'b'.repeat(64), sizeBytes: 10 },
    { opportunityId: ids.aberta1!, companyId, kind: 'proposal', origin: 'upload', title: 'PRIVADO da empresa', mimeType: 'application/pdf', storageKey: `companies/${companyId}/${crypto.randomUUID()}.pdf` },
  ]);
  const docs = await listPublicDocuments(db, ids.aberta1!);
  assert.deepEqual(docs.items.map((d) => d.title).sort(), ['Baixado', 'Edital']);
  assert.deepEqual(docs.items.map((d) => [d.title, d.stored]).sort(), [['Baixado', true], ['Edital', false]]);
  assert.ok(docs.items.every((d) => !('storageKey' in d) && !('companyId' in d)));
  assert.doesNotThrow(() => publicDocumentPage.parse(docs));
});

test('fontes: lista sem config nem cursor', async () => {
  const r = await listSources(db);
  assert.doesNotThrow(() => sourcePage.parse(r));
  const minha = r.items.find((x) => x.key === KEY);
  assert.deepEqual(minha, { key: KEY, name: 'Teste T-204', kind: 'api', enabled: true, lastSyncAt: null, lastSyncStatus: null });
  assert.ok(r.items.every((x) => !('config' in x) && !('lastCursor' in x)));
});

test('preços: só itens homologados, filtro por UF, resumo sobre todas as amostras e cursor', async () => {
  const token = `papelx${run}`;
  let seq = 100;
  const mk = async (n: string, valor: string, estimado: string | null, quando: string | null) => {
    await db.insert(s.opportunityItems).values({
      opportunityId: n === 'sp' ? ids.aberta2! : ids.aberta1!, number: (seq += 1), description: `${token} ${n} resma`, kind: 'material', quantity: '10', unit: 'UN',
      estimatedUnitValue: estimado, awardedUnitValue: valor, awardedSupplierCnpj: '11222333000181', awardedSupplierName: 'Fornecedor Teste', awardedAt: quando ? new Date(quando) : null,
    });
  };
  await mk('rj1', '10.0000', '12.5000', '2026-11-01T12:00:00Z');
  await mk('rj2', '20.0000', null, '2026-11-02T12:00:00Z');
  await mk('rj3', '30.0000', '30.0000', '2026-11-03T12:00:00Z');
  await mk('sp', '40.0000', '50.0000', null);
  await db.insert(s.opportunityItems).values({ opportunityId: ids.aberta1!, number: 999_001, description: `${token} sem resultado`, kind: 'material', quantity: '1', unit: 'UN', estimatedUnitValue: '5.0000' });

  const todos = await listPrices(db, priceQuery.parse({ q: token, limit: '2' }));
  assert.doesNotThrow(() => pricePage.parse(todos));
  assert.deepEqual(todos.summary, { count: 4, min: '10.0000', median: '25.0000', max: '40.0000' });
  assert.equal(todos.items.length, 2);
  assert.ok(todos.nextCursor);
  assert.equal(todos.items[0]!.description.includes('rj3'), true, 'mais recente primeiro');
  const rj1 = (await listPrices(db, priceQuery.parse({ q: `${token} rj1` }))).items[0]!;
  assert.equal(rj1.discountPercent, '20.00');
  assert.equal(rj1.uf, 'RJ');
  assert.equal((await listPrices(db, priceQuery.parse({ q: `${token} rj2` }))).items[0]!.discountPercent, null, 'sem estimado → sem desconto');

  const vistos = [...todos.items.map((i) => i.itemId)];
  const p2 = await listPrices(db, priceQuery.parse({ q: token, limit: '2', cursor: todos.nextCursor! }));
  vistos.push(...p2.items.map((i) => i.itemId));
  assert.equal(new Set(vistos).size, 4);
  assert.equal(p2.nextCursor, null);
  assert.equal(p2.items.at(-1)!.awardedAt, null, 'sem data de resultado por último');

  const soSp = await listPrices(db, priceQuery.parse({ q: token, ufs: 'SP' }));
  assert.deepEqual(soSp.summary, { count: 1, min: '40.0000', median: '40.0000', max: '40.0000' });
  const nada = await listPrices(db, priceQuery.parse({ q: `inexistente${run}` }));
  assert.deepEqual(nada, { items: [], nextCursor: null, summary: { count: 0, min: null, median: null, max: null } });
  await assert.rejects(listPrices(db, priceQuery.parse({ q: token, cursor: 'lixo' })), InvalidCursor);
});

test('pedido de sincronização: audita, valida a fonte e respeita desabilitada', async () => {
  const user = (await db.insert(s.userAccounts).values({ keycloakSub: `t204-${run}`, email: 't204@exemplo.test', name: 'Admin' }).returning({ id: s.userAccounts.id }))[0]!;
  const chamadas: unknown[][] = [];
  const fake = (async (...a: unknown[]) => {
    chamadas.push(a);
    return 'job-1';
  }) as never;
  const input = { actorUserId: user.id, ipHash: null, requestId: null };

  const ok = await requestSync(db, { sourceKey: KEY, mode: 'backfill', since: '2026-11-01T00:00:00Z', ...input }, fake);
  assert.deepEqual(ok, { status: 'accepted', jobId: 'job-1' });
  assert.deepEqual(chamadas[0], ['source.sync', { sourceKey: KEY, mode: 'backfill', since: '2026-11-01T00:00:00Z' }]);
  const [aud] = await db.select().from(s.auditEvents).where(eq(s.auditEvents.actorUserId, user.id));
  assert.equal(aud!.action, 'source.sync_requested');
  assert.equal(aud!.entityId, sourceId);

  assert.deepEqual(await requestSync(db, { sourceKey: 'fonte_que_nao_existe', mode: 'incremental', ...input }, fake), { status: 'unknown_source' });
  assert.equal(chamadas.length, 1, 'fonte desconhecida não enfileira');
  // Conector registrado ainda sem linha em `sources` é aceito (a linha nasce na 1ª sincronização).
  await db.update(s.sources).set({ enabled: false }).where(eq(s.sources.id, sourceId));
  assert.deepEqual(await requestSync(db, { sourceKey: KEY, mode: 'incremental', ...input }, fake), { status: 'disabled' });
  assert.equal(chamadas.length, 1);
  await db.update(s.sources).set({ enabled: true }).where(eq(s.sources.id, sourceId));
});
