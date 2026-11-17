/**
 * T-202 — integração com Postgres real (banco descartável migrado + schema pgboss).
 *   DATABASE_URL_TEST (nett_app) e DATABASE_URL_MIGRATOR (instala pgboss)
 *   npm run test:sources:integration
 * O conector aqui é controlado (páginas em memória) com payloads REAIS do PNCP (__fixtures__),
 * para cenários determinísticos. A consulta ao vivo está em pncp.live.test.ts.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import * as s from '../db/schema';
import { createBoss } from '../jobs/boss';
import { stableKey } from '../jobs/enqueue';
import { buildRegistry } from '../jobs/handlers';
import { setupJobs } from '../jobs/setup';
import { SourceRateLimited, type FetchPageResult, type SyncableConnector, type SyncFeed } from './connector';
import { normalizeSourceRecord } from './normalize-record';
import fixturesReais from './pncp/__fixtures__/compras-reais.json';
import { normalizePncp } from './pncp/normalize';
import { opportunitySearchCondition } from './read/opportunities';
import { buildSearchText } from './read/search-index';
import { payloadHash as payloadHashOf, syncSource } from './sync';

const appUrl = process.env.DATABASE_URL_TEST;
const migratorUrl = process.env.DATABASE_URL_MIGRATOR;
if (!appUrl || !migratorUrl) throw new Error('DATABASE_URL_TEST e DATABASE_URL_MIGRATOR são obrigatórias');

const run = Date.now().toString(36);
/** Payloads reais com sequencial único por execução: oportunidades são globais e o banco de teste é reutilizado. */
const base = 100_000 + (Date.now() % 800_000);
const fx = fixturesReais.map((f, i) => {
  const seq = base + i;
  const [cnpj, , , ano] = f.compra.numeroControlePNCP.split(/[-/]/);
  const numeroControlePNCP = `${cnpj}-1-${String(seq).padStart(6, '0')}/${ano}`;
  return { ...f, compra: { ...f.compra, numeroControlePNCP, sequencialCompra: seq } };
});
const KEY = `pncp_t${run}`.slice(0, 40);
let pool: Pool;
let boss: PgBoss;
// Linhas globais criadas por este arquivo; removidas em after() para não deixar SearchProfile ativo no banco compartilhado
// (o sync enriquece o que casa com QUALQUER perfil ativo e outros testes contam perfis).
const criados: { profileId?: string; companyId?: string; userId?: string } = {};
const db = () => drizzle(pool, { schema: s, casing: 'snake_case' });

/** Conector controlado: páginas fixas; enriquecimento devolve o payload completo das fx. */
class FakeConnector implements SyncableConnector {
  readonly key = KEY;
  definition = { name: 'PNCP (teste)', kind: 'api' as const, baseUrl: 'https://pncp.gov.br/api', rateLimit: { requestsPerMinute: 60, maxConcurrency: 1 }, config: {} };
  pages: Array<Array<{ externalId: string; payload: unknown }>> = [];
  fetches: number[] = [];
  enrichCalls = 0;
  enrichFails = false;
  /** Página em que a fonte responde 429 (T-213). */
  rateLimitAt: number | null = null;
  cursorFrom() {
    return { page: 0 };
  }
  resumeCursor(saved: unknown) {
    return saved;
  }
  async fetchPage(cursor: unknown): Promise<FetchPageResult> {
    const page = (cursor as { page: number }).page;
    this.fetches.push(page);
    if (this.rateLimitAt === page) throw new SourceRateLimited('429 simulado', 900_000);
    return { records: this.pages[page] ?? [], nextCursor: page + 1 < this.pages.length ? { page: page + 1 } : null };
  }
  normalize(payload: unknown) {
    return normalizePncp(payload);
  }
  listingOf(payload: unknown) {
    return (payload as { compra: unknown }).compra;
  }
  isEnriched(payload: unknown) {
    return Array.isArray((payload as { itens?: unknown }).itens);
  }
  async enrich(payload: unknown): Promise<unknown> {
    this.enrichCalls += 1;
    if (this.enrichFails) throw new Error('PNCP 503 simulado');
    const ctl = (payload as { compra: { numeroControlePNCP: string } }).compra.numeroControlePNCP;
    return fx.find((f) => f.compra.numeroControlePNCP === ctl)!;
  }
}

const listagem = (f: (typeof fx)[number], patch: Record<string, unknown> = {}) => ({
  externalId: f.compra.numeroControlePNCP,
  payload: { compra: { ...f.compra, ...patch } },
});

let fake: FakeConnector;
const deps = () => ({ pool, boss, connectors: new Map([[KEY, fake]]) });

/** Executa a fila source.normalize até esvaziar (sem worker em segundo plano). */
async function drainNormalize() {
  let total = 0;
  for (;;) {
    const jobs = await boss.fetch<{ sourceRecordId: string }>('source.normalize', { batchSize: 50 });
    if (!jobs.length) return total;
    for (const j of jobs) {
      await normalizeSourceRecord(deps(), j.data.sourceRecordId);
      await boss.complete('source.normalize', j.id);
      total += 1;
    }
  }
}

before(async () => {
  await setupJobs(migratorUrl);
  pool = new Pool({ connectionString: appUrl, max: 5 });
  boss = createBoss(appUrl);
  await boss.start();
  // Perfil ativo que casa só com a 1ª fixture (serviços de gerenciamento de frota).
  const [company] = await db().insert(s.companies).values({ legalName: `Empresa ${run}`, cnpj: String(Date.now()).slice(-10).padStart(14, '8'), size: 'ME' }).returning({ id: s.companies.id });
  const [user] = await db().insert(s.userAccounts).values({ keycloakSub: `sub-src-${run}`, email: 'src@exemplo.test', name: 'Teste' }).returning({ id: s.userAccounts.id });
  criados.companyId = company!.id;
  criados.userId = user!.id;
  const [perfil] = await db().insert(s.searchProfiles).values({ companyId: company!.id, name: `Frotas ${run}`, includeTerms: ['frota', 'gerenciamento de frotas'], ownerUserId: user!.id, sourceKeys: [KEY] }).returning({ id: s.searchProfiles.id });
  criados.profileId = perfil!.id;
});

after(async () => {
  for (const q of ['source.sync', 'source.normalize', 'document.fetch', 'match.score'] as const) await boss.deleteQueuedJobs(q);
  await boss.stop({ graceful: false });
  // Ordem pelas FKs: perfil → empresa → usuário. Roda mesmo se algum teste falhou.
  if (criados.profileId) await db().delete(s.searchProfiles).where(eq(s.searchProfiles.id, criados.profileId));
  if (criados.companyId) await db().delete(s.companies).where(eq(s.companies.id, criados.companyId));
  if (criados.userId) await db().delete(s.userAccounts).where(eq(s.userAccounts.id, criados.userId));
  await pool.end();
});

beforeEach(() => {
  fake = new FakeConnector();
});

test('sync grava SourceRecords, enriquece só o que casa com SearchProfile e enfileira normalize na mesma transação', async () => {
  fake.pages = [[listagem(fx[0]), listagem(fx[1])]];
  const r = await syncSource(deps(), { sourceKey: KEY, mode: 'incremental' });
  assert.equal(r.status, 'ok');
  assert.equal(r.stoppedBy, 'caught_up');
  assert.deepEqual({ records: r.records, newRecords: r.newRecords, matched: r.matched, enriched: r.enriched }, { records: 2, newRecords: 2, matched: 1, enriched: 1 });

  const [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  assert.equal(src!.lastSyncStatus, 'ok');
  assert.deepEqual(src!.lastCursor, { page: 0 }); // alcançou o fim: relê a última página na próxima execução

  const recs = await db().select().from(s.sourceRecords).where(eq(s.sourceRecords.sourceId, src!.id));
  assert.equal(recs.length, 2);
  const enriquecido = recs.find((x) => x.externalId === fx[0].compra.numeroControlePNCP)!;
  assert.ok(Array.isArray((enriquecido.payload as { itens: unknown[] }).itens));
  assert.equal((await boss.findJobs('source.normalize', { queued: true })).length >= 2, true);

  const audit = await db().select().from(s.auditEvents).where(eq(s.auditEvents.entityId, src!.id));
  assert.equal(audit.at(-1)!.action, 'source.sync');
});

test('reexecução não duplica registros nem reenriquece (idempotente)', async () => {
  fake.pages = [[listagem(fx[0]), listagem(fx[1])]];
  const r = await syncSource(deps(), { sourceKey: KEY, mode: 'incremental' });
  assert.equal(r.newRecords, 0);
  assert.equal(fake.enrichCalls, 0);
});

test('normalize: uma Opportunity por canonicalKey, itens e documentos, match.score e document.fetch enfileirados', async () => {
  const n = await drainNormalize();
  assert.ok(n >= 2);
  const key0 = normalizePncp(fx[0]);
  assert.ok(!('skip' in key0));
  if ('skip' in key0) return;
  const [opp] = await db().select().from(s.opportunities).where(eq(s.opportunities.canonicalKey, key0.opportunity.canonicalKey));
  assert.ok(opp);
  assert.equal(opp.contentHash, key0.opportunity.contentHash);
  assert.equal(opp.estimatedValue, '6000000.0000');
  const itens = await db().select().from(s.opportunityItems).where(eq(s.opportunityItems.opportunityId, opp.id));
  assert.equal(itens.length, fx[0].itens.length);
  const docs = await db().select().from(s.documents).where(eq(s.documents.opportunityId, opp.id));
  assert.equal(docs.length, key0.documents.length);
  assert.ok(docs.every((d) => d.companyId === null && d.origin === 'source' && d.storageKey === null && d.textStatus === 'pending'));

  // T-215: o normalize grava o texto de busca (minúsculas, sem acento) na mesma transação.
  const [busca] = await db().select().from(s.opportunitySearch).where(eq(s.opportunitySearch.opportunityId, opp.id));
  assert.ok(busca, 'linha em opportunity_search');
  assert.equal(busca.searchText, buildSearchText({ title: opp.title, objectDescription: opp.objectDescription, agencyName: opp.agencyName, agencyUnit: opp.agencyUnit, municipality: opp.municipality }));
  assert.ok(busca.searchText.includes('gerenciamento') && busca.searchText.includes('frota'));
  assert.equal(busca.searchText, busca.searchText.toLowerCase());
  assert.doesNotMatch(busca.searchText, /[\u0300-\u036f]|[ãçéíóúâêô]/);

  const fetchJobs = await boss.findJobs<{ documentId: string }>('document.fetch', { queued: true });
  assert.ok(docs.every((d) => fetchJobs.some((j) => j.data.documentId === d.id)));
  const scoreJobs = await boss.findJobs<{ opportunityId: string }>('match.score', { queued: true });
  assert.ok(scoreJobs.some((j) => j.data.opportunityId === opp.id));

  // A 2ª fixture (não casa com o perfil) vira Opportunity só com a listagem: sem itens/documentos.
  const key1 = normalizePncp({ compra: fx[1].compra });
  if ('skip' in key1) throw new Error(key1.skip);
  const [opp1] = await db().select().from(s.opportunities).where(eq(s.opportunities.canonicalKey, key1.opportunity.canonicalKey));
  assert.equal((await db().select().from(s.opportunityItems).where(eq(s.opportunityItems.opportunityId, opp1!.id))).length, 0);
});

test('alteração na fonte: novo SourceRecord, mesma Opportunity, contentHash atualizado, firstSeenAt preservado', async () => {
  const k = normalizePncp(fx[0]);
  if ('skip' in k) throw new Error(k.skip);
  const [antes] = await db().select().from(s.opportunities).where(eq(s.opportunities.canonicalKey, k.opportunity.canonicalKey));
  await boss.deleteQueuedJobs('match.score');

  const alterada = { ...fx[0], compra: { ...fx[0].compra, dataEncerramentoProposta: '2026-12-30T09:00:00' } };
  fake.pages = [[{ externalId: alterada.compra.numeroControlePNCP, payload: { compra: alterada.compra } }]];
  fake.enrich = async () => alterada;
  const r = await syncSource(deps(), { sourceKey: KEY, mode: 'backfill' });
  assert.equal(r.newRecords, 1);
  await drainNormalize();

  const opps = await db().select().from(s.opportunities).where(eq(s.opportunities.canonicalKey, k.opportunity.canonicalKey));
  assert.equal(opps.length, 1);
  assert.notEqual(opps[0]!.contentHash, antes!.contentHash);
  assert.equal(opps[0]!.firstSeenAt.getTime(), antes!.firstSeenAt.getTime());
  assert.equal(opps[0]!.proposalsCloseAt!.toISOString(), '2026-12-30T12:00:00.000Z');
  const versoes = await db().select().from(s.sourceRecords).where(eq(s.sourceRecords.externalId, k.opportunity.canonicalKey.length ? fx[0].compra.numeroControlePNCP : ''));
  assert.ok(versoes.length >= 2);
  assert.ok((await boss.findJobs<{ opportunityId: string }>('match.score', { queued: true })).some((j) => j.data.opportunityId === antes!.id));
  // Documentos já existentes não são duplicados.
  assert.equal((await db().select().from(s.documents).where(eq(s.documents.opportunityId, antes!.id))).length, k.documents.length);
});

test('registro fora de ordem não sobrescreve versão mais nova', async () => {
  const ctl = fx[0].compra.numeroControlePNCP;
  const [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  const [velho] = await db()
    .insert(s.sourceRecords)
    .values({ sourceId: src!.id, externalId: ctl, payload: { compra: { ...fx[0].compra, objetoCompra: 'versão antiga' } }, payloadHash: 'c'.repeat(64), fetchedAt: new Date('2020-01-01T00:00:00Z') })
    .returning({ id: s.sourceRecords.id });
  const r = await normalizeSourceRecord(deps(), velho!.id);
  assert.equal(r.status, 'superseded');
  const [opp] = await db().select().from(s.opportunities).where(sql`${s.opportunities.objectDescription} like 'versão antiga%'`);
  assert.equal(opp, undefined);
});

test('versão só com listagem preserva meEppBenefit calculado dos itens (e atualiza o resto)', async () => {
  const k = normalizePncp(fx[0]);
  if ('skip' in k) throw new Error(k.skip);
  const chave = k.opportunity.canonicalKey;
  const [antes] = await db().select().from(s.opportunities).where(eq(s.opportunities.canonicalKey, chave));
  assert.equal(antes!.meEppBenefit, 'none', 'calculado dos itens enriquecidos');
  const itensAntes = (await db().select().from(s.opportunityItems).where(eq(s.opportunityItems.opportunityId, antes!.id))).length;
  assert.ok(itensAntes > 0);
  await boss.deleteQueuedJobs('match.score');

  const [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  const listagem = { compra: { ...fx[0].compra, dataEncerramentoProposta: '2027-01-15T09:00:00' } }; // sem itens/arquivos
  const [rec] = await db()
    .insert(s.sourceRecords)
    .values({ sourceId: src!.id, externalId: fx[0].compra.numeroControlePNCP, payload: listagem, payloadHash: payloadHashOf(listagem) })
    .returning({ id: s.sourceRecords.id });
  const r = await normalizeSourceRecord(deps(), rec!.id);
  assert.equal(r.status, 'normalized');

  const [depois] = await db().select().from(s.opportunities).where(eq(s.opportunities.canonicalKey, chave));
  assert.equal(depois!.meEppBenefit, 'none', 'não volta para unknown');
  assert.equal(depois!.proposalsCloseAt!.toISOString(), '2027-01-15T12:00:00.000Z', 'o restante da listagem é atualizado');
  assert.notEqual(depois!.contentHash, antes!.contentHash);
  assert.equal((await db().select().from(s.opportunityItems).where(eq(s.opportunityItems.opportunityId, antes!.id))).length, itensAntes, 'itens existentes não são apagados');
  assert.ok((await boss.findJobs<{ opportunityId: string }>('match.score', { queued: true })).some((j) => j.data.opportunityId === antes!.id), 'mudança real reenfileira match.score');

  // Oportunidade nova só com listagem continua 'unknown' (nada a preservar).
  const nova = { compra: { ...fx[1].compra, numeroControlePNCP: `${fx[1].compra.numeroControlePNCP.slice(0, 17)}${String(base + 777).padStart(6, '0')}/2026`, sequencialCompra: base + 777 } };
  const [rec2] = await db()
    .insert(s.sourceRecords)
    .values({ sourceId: src!.id, externalId: nova.compra.numeroControlePNCP, payload: nova, payloadHash: payloadHashOf(nova) })
    .returning({ id: s.sourceRecords.id });
  const r2 = await normalizeSourceRecord(deps(), rec2!.id);
  assert.equal(r2.status, 'normalized');
  if (r2.status !== 'normalized') return;
  const [op2] = await db().select().from(s.opportunities).where(eq(s.opportunities.id, r2.opportunityId));
  assert.equal(op2!.meEppBenefit, 'unknown');
});

test('texto de busca acompanha a oportunidade: atualiza quando o objeto muda e o registro antigo some da busca', async () => {
  const k = normalizePncp(fx[0]);
  if ('skip' in k) throw new Error(k.skip);
  const [opp] = await db().select().from(s.opportunities).where(eq(s.opportunities.canonicalKey, k.opportunity.canonicalKey));
  const [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  const palavraNova = `zzparalelepípedo${run}`;
  const listagem = { compra: { ...fx[0].compra, objetoCompra: `Fornecimento de ${palavraNova} para vias`, dataEncerramentoProposta: '2027-02-20T09:00:00' } };
  const [rec] = await db()
    .insert(s.sourceRecords)
    .values({ sourceId: src!.id, externalId: fx[0].compra.numeroControlePNCP, payload: listagem, payloadHash: payloadHashOf(listagem) })
    .returning({ id: s.sourceRecords.id });
  assert.equal((await normalizeSourceRecord(deps(), rec!.id)).status, 'normalized');
  const [linha] = await db().select().from(s.opportunitySearch).where(eq(s.opportunitySearch.opportunityId, opp!.id));
  assert.ok(linha!.searchText.includes(`zzparalelepipedo${run}`), 'texto novo, sem acento');
  assert.ok(!linha!.searchText.includes('gerenciamento'), 'texto antigo substituído');
  const achou = await db().select({ id: s.opportunities.id }).from(s.opportunities).where(opportunitySearchCondition(`ZZParalelepípedo${run}`));
  assert.deepEqual(achou.map((r) => r.id), [opp!.id], 'a busca (com acento e caixa) acha pelo termo novo');
  assert.deepEqual(await db().select({ id: s.opportunities.id }).from(s.opportunities).where(opportunitySearchCondition('gerenciamento frota')).then((r) => r.filter((x) => x.id === opp!.id)), [], 'termo antigo não acha mais');
});

test('atomicidade: se o enfileiramento falhar, nem a oportunidade nem o texto de busca ficam gravados', async () => {
  const seq = base + 888;
  const compra = { ...fx[1].compra, numeroControlePNCP: `${fx[1].compra.numeroControlePNCP.slice(0, 17)}${String(seq).padStart(6, '0')}/2026`, sequencialCompra: seq, objetoCompra: `Objeto atômico ${run}` };
  const payload = { compra };
  const [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  const [rec] = await db().insert(s.sourceRecords).values({ sourceId: src!.id, externalId: compra.numeroControlePNCP, payload, payloadHash: payloadHashOf(payload) }).returning({ id: s.sourceRecords.id });
  const quebrado = { ...boss, send: async () => { throw new Error('falha simulada no pg-boss'); }, findJobs: boss.findJobs.bind(boss) } as unknown as PgBoss;
  await assert.rejects(normalizeSourceRecord({ ...deps(), boss: quebrado }, rec!.id), /falha simulada/);
  const [depois] = await db().select().from(s.sourceRecords).where(eq(s.sourceRecords.id, rec!.id));
  assert.equal(depois!.normalizationStatus, 'pending', 'registro continua pendente (retentável)');
  const op = await db().select({ id: s.opportunities.id }).from(s.opportunities).where(eq(s.opportunities.canonicalKey, `pncp:${compra.numeroControlePNCP.slice(0, 14)}-2026-${seq}`));
  assert.equal(op.length, 0, 'sem oportunidade');
  const orfas = await db().execute(sql`select count(*)::int as n from opportunity_search where search_text like ${`%objeto atomico ${run}%`}`);
  assert.equal((orfas.rows[0] as { n: number }).n, 0, 'sem texto de busca');
  // Retentativa com a fila saudável conclui normalmente.
  assert.equal((await normalizeSourceRecord(deps(), rec!.id)).status, 'normalized');
  const [ok] = await db().select({ n: sql<number>`count(*)::int` }).from(s.opportunitySearch).where(sql`${s.opportunitySearch.searchText} like ${`%objeto atomico ${run}%`}`);
  assert.equal(ok!.n, 1);
});

test('payload inválido → skipped com motivo, sem Opportunity', async () => {
  const [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  const [rec] = await db().insert(s.sourceRecords).values({ sourceId: src!.id, externalId: `x-${run}`, payload: { compra: { objetoCompra: 'sem id' } }, payloadHash: 'd'.repeat(64) }).returning({ id: s.sourceRecords.id });
  const r = await normalizeSourceRecord(deps(), rec!.id);
  assert.equal(r.status, 'skipped');
  const [depois] = await db().select().from(s.sourceRecords).where(eq(s.sourceRecords.id, rec!.id));
  assert.equal(depois!.normalizationStatus, 'skipped');
  assert.match(depois!.normalizationError ?? '', /inválido/);
  assert.equal((await normalizeSourceRecord(deps(), rec!.id)).status, 'already_done');
});

test('orçamento de enriquecimento esgotado: para sem descartar e retoma da mesma página', async () => {
  const novos = [fx[0], fx[0]].map((f, i) => listagem(f, { numeroControlePNCP: `${f.compra.numeroControlePNCP.slice(0, 17)}${String(900 + i).padStart(6, '0')}/2026`, sequencialCompra: 900 + i }));
  fake.pages = [novos, [listagem(fx[1])]];
  fake.enrich = async (p: unknown) => {
    fake.enrichCalls += 1;
    const c = (p as { compra: Record<string, unknown> }).compra;
    return { ...fx[0], compra: c };
  };
  await db().update(s.sources).set({ lastCursor: { page: 0 } }).where(eq(s.sources.key, KEY));
  const r1 = await syncSource({ ...deps(), limits: { enrichBudget: 1 } }, { sourceKey: KEY, mode: 'incremental' });
  assert.equal(r1.stoppedBy, 'enrich_budget');
  assert.equal(r1.status, 'partial');
  assert.equal(r1.enriched, 1);
  let [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  assert.deepEqual(src!.lastCursor, { page: 0 });

  const r2 = await syncSource({ ...deps(), limits: { enrichBudget: 5 } }, { sourceKey: KEY, mode: 'incremental' });
  assert.equal(r2.enriched, 1); // só o que faltou
  assert.equal(r2.stoppedBy, 'caught_up');
  [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  assert.deepEqual(src!.lastCursor, { page: 1 });
});

test('falha de enriquecimento: grava a listagem (nada perdido), pausa enriquecimento e marca partial', async () => {
  const novo = listagem(fx[0], { numeroControlePNCP: `${fx[0].compra.numeroControlePNCP.slice(0, 17)}000950/2026`, sequencialCompra: 950 });
  fake.pages = [[novo]];
  fake.enrichFails = true;
  await db().update(s.sources).set({ lastCursor: { page: 0 } }).where(eq(s.sources.key, KEY));
  const r = await syncSource(deps(), { sourceKey: KEY, mode: 'incremental' });
  assert.equal(r.status, 'partial');
  assert.equal(r.enrichErrors, 1);
  assert.equal(r.newRecords, 1);
  // Próxima execução com a fonte de volta: o mesmo registro é enriquecido.
  fake.enrichFails = false;
  fake.enrich = async (p: unknown) => ({ ...fx[0], compra: (p as { compra: unknown }).compra });
  const r2 = await syncSource(deps(), { sourceKey: KEY, mode: 'incremental' });
  assert.equal(r2.enriched, 1);
  assert.equal(r2.newRecords, 1);
});

test('handler registrado: source.sync e source.normalize via JobRegistry', async () => {
  fake.pages = [[]];
  const reg = buildRegistry({ pool, boss, connectors: new Map([[KEY, fake]]) });
  // match.* são do agente 03 (T-305, contratos 1.4.0) e também são registrados em buildRegistry.
  assert.deepEqual(reg.names().sort(), ['document.fetch', 'match.profile', 'match.refresh', 'match.score', 'source.normalize', 'source.sync']);
  await reg.run('source.sync', { sourceKey: KEY, mode: 'incremental' }, { jobId: 'x', retryCount: 0, signal: new AbortController().signal });
  await assert.rejects(() => reg.run('source.normalize', { sourceRecordId: 'nao-uuid' }, { jobId: 'x', retryCount: 0, signal: new AbortController().signal }));
});

// ---- T-213 / ADR-023: orçamento de tempo, 429 sem retentativa, cursor por feed, continuação ----

/** Conector com um cursor por feed dentro de `last_cursor` ({ v: 2, feeds }), como o PncpConnector. */
class FeedConnector extends FakeConnector {
  override cursorFrom(_since?: Date | null, _feed?: SyncFeed) {
    return { page: 0 };
  }
  override resumeCursor(saved: unknown, feed: SyncFeed = 'updates') {
    const c = (saved as { feeds?: Record<string, { page: number; done?: boolean }> } | null)?.feeds?.[feed];
    return c && !c.done ? c : null; // varredura concluída recomeça
  }
  storeCursor(current: unknown, feed: SyncFeed, cursor: unknown) {
    return { v: 2, feeds: { ...((current as { feeds?: object } | null)?.feeds ?? {}), [feed]: cursor } };
  }
  completedCursor(cursor: unknown) {
    return { ...(cursor as object), done: true };
  }
}

test('orçamento de tempo: para antes da próxima página, mantém o cursor nela e marca partial (time_budget)', async () => {
  fake.pages = [[listagem(fx[0])], [listagem(fx[1])], [listagem(fx[2])]];
  await db().update(s.sources).set({ lastCursor: { page: 0 } }).where(eq(s.sources.key, KEY));
  let relogio = Date.parse('2026-11-17T12:00:00Z');
  const r = await syncSource({ ...deps(), limits: { maxMs: 600_000 }, now: () => new Date((relogio += 400_000)) }, { sourceKey: KEY, mode: 'incremental' });
  assert.equal(r.stoppedBy, 'time_budget');
  assert.equal(r.status, 'partial');
  assert.equal(r.pages, 1);
  assert.deepEqual(fake.fetches, [0]);
  const [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  assert.deepEqual(src!.lastCursor, { page: 1 }); // retoma na página seguinte
});

test('429 nunca é retentado: execução parcial sem erro, 1 só tentativa na página, cursor mantido e cooldown informado', async () => {
  fake.pages = [[listagem(fx[0])], [listagem(fx[1])]];
  fake.rateLimitAt = 1;
  await db().update(s.sources).set({ lastCursor: { page: 0 } }).where(eq(s.sources.key, KEY));
  const r = await syncSource(deps(), { sourceKey: KEY, mode: 'incremental' }); // não lança: o pg-boss não retenta
  assert.equal(r.status, 'partial');
  assert.equal(r.stoppedBy, 'rate_limited');
  assert.equal(r.cooldownMs, 900_000);
  assert.deepEqual(fake.fetches, [0, 1], 'a página que recebeu 429 foi pedida UMA vez');
  const [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  assert.deepEqual(src!.lastCursor, { page: 1 }); // a página 0 foi gravada; retoma na que recebeu 429
  assert.equal(src!.lastSyncStatus, 'partial');
});

test('429 durante o enriquecimento também encerra a execução sem retentar', async () => {
  // Registro novo (os de fx[0] já foram gravados e enriquecidos por testes anteriores: não precisariam de enriquecimento).
  fake.pages = [[listagem(fx[0], { numeroControlePNCP: `${fx[0].compra.numeroControlePNCP.slice(0, 17)}000951/2026`, sequencialCompra: 951 })]];
  fake.enrich = async () => {
    fake.enrichCalls += 1;
    throw new SourceRateLimited('429 simulado', 900_000);
  };
  await db().update(s.sources).set({ lastCursor: { page: 0 } }).where(eq(s.sources.key, KEY));
  const r = await syncSource(deps(), { sourceKey: KEY, mode: 'incremental' });
  assert.equal(r.stoppedBy, 'rate_limited');
  assert.equal(fake.enrichCalls, 1);
  assert.equal(r.enrichErrors, 0); // limite da fonte não é falha de enriquecimento
});

test('cursor por feed: proposals não apaga o cursor de updates e uma varredura concluída recomeça na vez seguinte', async () => {
  const feeds = new FeedConnector();
  const d = () => ({ pool, boss, connectors: new Map<string, SyncableConnector>([[KEY, feeds]]) });
  feeds.pages = [[listagem(fx[0])]];
  await db().update(s.sources).set({ lastCursor: { v: 2, feeds: { updates: { page: 9 } } } }).where(eq(s.sources.key, KEY));
  const r1 = await syncSource(d(), { sourceKey: KEY, mode: 'incremental', feed: 'proposals' });
  assert.equal(r1.feed, 'proposals');
  assert.equal(r1.stoppedBy, 'caught_up');
  let [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  assert.deepEqual(src!.lastCursor, { v: 2, feeds: { updates: { page: 9 }, proposals: { page: 0, done: true } } });
  // Nova execução de proposals: recomeça do início (cursor concluído); o do updates continua intacto.
  feeds.fetches = [];
  await syncSource(d(), { sourceKey: KEY, mode: 'incremental', feed: 'proposals' });
  assert.deepEqual(feeds.fetches, [0]);
  [src] = await db().select().from(s.sources).where(eq(s.sources.key, KEY));
  assert.deepEqual((src!.lastCursor as { feeds: { updates: unknown } }).feeds.updates, { page: 9 });
  // O feed updates retoma o seu próprio cursor (página 9), não o de proposals.
  feeds.fetches = [];
  await syncSource(d(), { sourceKey: KEY, mode: 'incremental' });
  assert.deepEqual(feeds.fetches, [9]);
});

test('handler: proposals interrompido por orçamento reenfileira o mesmo payload (startAfter); updates não', async () => {
  fake.pages = [[]];
  const reg = buildRegistry({ pool, boss, connectors: new Map([[KEY, fake]]), limits: { maxMs: 0 } });
  const ctx = { jobId: 'x', retryCount: 0, signal: new AbortController().signal };
  const proposals = { sourceKey: KEY, mode: 'incremental' as const, feed: 'proposals' as const };
  await reg.run('source.sync', proposals, ctx);
  const filhos = await boss.findJobs('source.sync', { key: stableKey(proposals), queued: true });
  assert.equal(filhos.length, 1);
  assert.ok(filhos[0]!.startAfter.getTime() > Date.now() + 10_000, 'a continuação espera, não roda de imediato');
  await reg.run('source.sync', proposals, ctx); // idempotente: não duplica
  assert.equal((await boss.findJobs('source.sync', { key: stableKey(proposals), queued: true })).length, 1);
  const updates = { sourceKey: KEY, mode: 'incremental' as const };
  await reg.run('source.sync', updates, ctx);
  assert.equal((await boss.findJobs('source.sync', { key: stableKey(updates), queued: true })).length, 0);
});
