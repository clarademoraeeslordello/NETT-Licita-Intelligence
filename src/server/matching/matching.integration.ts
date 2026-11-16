/**
 * T-305 integration with Postgres (DATABASE_URL_TEST, role nett_app, migrated database).
 * Run: npm run test:analysis:integration
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { matchScore } from '../../contracts';
import type { Db } from '../db';
import * as s from '../db/schema';
import { buildRegistry } from '../jobs/handlers';
import { hardFilter } from './eligibility';
import { FANOUT_BATCH, fanOutProfile, matchSchedules, refreshOpenOpportunities } from './fanout';
import { getMatchSummaries, MAX_SCORE_AGE_MS, MAX_SUMMARY_IDS, scoreOpportunity } from './service';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST não configurada');
const pool = new Pool({ connectionString: url, max: 4 });
const db = drizzle(pool, { schema: s, casing: 'snake_case' }) as unknown as Db;
const run = Date.now().toString().slice(-9);
const hash = 'd'.repeat(64);
const day = 86_400_000;

let A: string, B: string, C: string, user: string, src: string, srcOther: string, opp: string;
let a1: string, a2: string, a3: string, a4: string, b1: string, c1: string;

let companySeq = 0; // the CNPJ column is unique: a counter, not a hand-picked digit
const company = async (n: string, _unused: number, status: 'active' | 'suspended') =>
  (await db.insert(s.companies).values({ legalName: `Empresa ${n}`, cnpj: `4${String(++companySeq).padStart(2, '0')}${run}00`.slice(0, 14).padEnd(14, '0'), size: 'EPP', status }).returning({ id: s.companies.id }))[0]!.id;
/** Every profile created here is removed in `after`: active profiles left in the shared test database would change
 *  what other suites see (e.g. the source sync enriches whatever matches ANY active profile). Scores cascade. */
const createdProfiles: string[] = [];
const profile = async (companyId: string, over: Partial<typeof s.searchProfiles.$inferInsert> = {}) => {
  const id = (await db.insert(s.searchProfiles).values({ companyId, name: 'p', includeTerms: ['lgpd'], ownerUserId: user, ufs: ['RN'], modalityCodes: [6], ...over }).returning({ id: s.searchProfiles.id }))[0]!.id;
  createdProfiles.push(id);
  return id;
};
const rowsFor = (opportunityId = opp) => db.select().from(s.matchScores).where(eq(s.matchScores.opportunityId, opportunityId));

before(async () => {
  A = await company('A', 1, 'active');
  B = await company('B', 2, 'active');
  C = await company('C', 3, 'suspended');
  [{ id: user }] = (await db.insert(s.userAccounts).values({ keycloakSub: `mt-${run}`, email: 'm@exemplo.test', name: 'M' }).returning({ id: s.userAccounts.id })) as [{ id: string }];
  [{ id: src }, { id: srcOther }] = (await db
    .insert(s.sources)
    .values([
      { key: `mt_${run}`, name: 'PNCP', kind: 'api', rateLimit: { requestsPerMinute: 30, maxConcurrency: 3 } },
      { key: `mt_other_${run}`, name: 'Outra', kind: 'api', rateLimit: { requestsPerMinute: 30, maxConcurrency: 3 } },
    ])
    .returning({ id: s.sources.id })) as [{ id: string }, { id: string }];
  void srcOther;
  [{ id: opp }] = await db
    .insert(s.opportunities)
    .values({
      canonicalKey: `pncp:mt${run}-2026-1`,
      primarySourceId: src,
      title: 'Pregão 99/2026',
      objectDescription: 'Consultoria para adequação à LGPD, mapeamento de dados pessoais, RIPD e DPO as a service',
      agencyName: 'Prefeitura Fictícia',
      sphere: 'municipal',
      status: 'receiving_proposals',
      uf: 'RN',
      modalityCode: 6,
      modalityName: 'Pregão - Eletrônico',
      estimatedValue: '180000',
      proposalsCloseAt: new Date(Date.now() + 20 * day),
      url: 'https://pncp.gov.br/x',
      contentHash: hash,
    })
    .returning({ id: s.opportunities.id });
  await db.insert(s.opportunityItems).values({ opportunityId: opp, number: 1, description: 'Serviço de adequação à LGPD', kind: 'service', quantity: '1', unit: 'SV' });
  a1 = await profile(A);
  a2 = await profile(A, { name: 'nacional', ufs: [] });
  a3 = await profile(A, { name: 'inativo', active: false });
  a4 = await profile(A, { name: 'outra fonte', sourceKeys: [`mt_other_${run}`] });
  b1 = await profile(B, { ufs: [] });
  c1 = await profile(C);
});
const createdSources: string[] = [];
after(async () => {
  for (const id of createdSources) await db.delete(s.opportunities).where(eq(s.opportunities.primarySourceId, id)); // scores and items cascade
  if (createdProfiles.length) await db.delete(s.searchProfiles).where(inArray(s.searchProfiles.id, createdProfiles));
  await pool.end();
});

test('uma nota por SearchProfile ativo de empresa ativa; inativo, outra fonte e empresa suspensa ficam de fora', async () => {
  // Without companyId it scores every active profile in the database (the shared test database may hold others).
  const r = await scoreOpportunity(db, { opportunityId: opp });
  assert.ok(r.opportunityFound && r.written >= 3);
  const mine = new Set([A, B, C]);
  const rows = (await rowsFor()).filter((m) => mine.has(m.companyId));
  assert.deepEqual(rows.map((m) => m.searchProfileId).sort(), [a1, a2, b1].sort());
  for (const absent of [a3, a4, c1]) assert.ok(!rows.some((m) => m.searchProfileId === absent));
  const sc = (id: string) => rows.find((m) => m.searchProfileId === id)!;
  assert.ok(sc(a1).score > sc(a2).score, 'UF na área de atuação pontua mais que perfil nacional');
  for (const m of rows) {
    const parsed = matchScore.safeParse({ ...m, computedAt: m.computedAt.toISOString() });
    assert.ok(parsed.success, 'linha obedece ao contrato MatchScore');
    assert.equal(m.algorithmVersion, 'fit-engine-1.0.0|weights-1.0.0|nett-dictionary-1.0.0');
    assert.equal(m.opportunityContentHash, hash);
  }
});

test('idempotente: repetir não regrava; muda o conteúdo, o perfil ou passa o prazo de validade → recalcula', async () => {
  // Scoped to this test's two companies (3 eligible profiles) so counts do not depend on other data.
  const both = async (now?: Date) => {
    const [x, y] = [await scoreOpportunity(db, { opportunityId: opp, companyId: A }, now), await scoreOpportunity(db, { opportunityId: opp, companyId: B }, now)];
    return { written: x.written + y.written, skipped: x.skipped + y.skipped };
  };
  const mineRows = async () => (await rowsFor()).filter((m) => [A, B, C].includes(m.companyId));
  const before = new Map((await mineRows()).map((m) => [m.searchProfileId, m.computedAt.getTime()]));
  assert.deepEqual(await both(), { written: 0, skipped: 3 });
  assert.deepEqual(new Map((await mineRows()).map((m) => [m.searchProfileId, m.computedAt.getTime()])), before);

  await db.update(s.searchProfiles).set({ updatedAt: new Date(Date.now() + 1_000) }).where(eq(s.searchProfiles.id, a1));
  assert.equal((await both(new Date(Date.now() + 2_000))).written, 1, 'perfil alterado');

  await db.update(s.opportunities).set({ contentHash: 'e'.repeat(64) }).where(eq(s.opportunities.id, opp));
  assert.equal((await both(new Date(Date.now() + 3_000))).written, 3, 'conteúdo alterado');
  assert.ok((await mineRows()).every((m) => m.opportunityContentHash === 'e'.repeat(64)));

  assert.equal((await both(new Date(Date.now() + MAX_SCORE_AGE_MS + 60_000))).written, 3, 'nota velha');
  assert.equal((await mineRows()).length, 3, 'upsert: continua uma linha por perfil');
});

test('companyId restringe a empresa; oportunidade inexistente não falha nem grava', async () => {
  const only = await scoreOpportunity(db, { opportunityId: opp, companyId: B }, new Date(Date.now() + 3 * MAX_SCORE_AGE_MS));
  assert.deepEqual({ eligible: only.eligible, written: only.written }, { eligible: 1, written: 1 });
  const ghost = await scoreOpportunity(db, { opportunityId: '00000000-0000-4000-8000-000000000000' });
  assert.deepEqual(ghost, { opportunityFound: false, eligible: 0, discarded: 0, unmatched: 0, written: 0, skipped: 0, removed: 0 });
});

test('getMatchSummaries: melhor nota dos perfis ativos, faixa e categoria; só da própria empresa', async () => {
  await scoreOpportunity(db, { opportunityId: opp, companyId: A }, new Date(Date.now() + 6 * MAX_SCORE_AGE_MS));
  await scoreOpportunity(db, { opportunityId: opp, companyId: B }, new Date(Date.now() + 6 * MAX_SCORE_AGE_MS));
  const rows = (await rowsFor()).filter((m) => [A, B, C].includes(m.companyId));
  const best = Math.max(...rows.filter((m) => m.companyId === A).map((m) => m.score));
  const summaries = await getMatchSummaries(db, A, [opp, opp, '00000000-0000-4000-8000-000000000000']);
  assert.deepEqual(Object.keys(summaries), [opp], 'sem nota guardada → ausente; duplicados não repetem');
  assert.equal(summaries[opp]!.score, best);
  assert.equal(summaries[opp]!.primaryCategory, 'lgpd');
  assert.equal(summaries[opp]!.band, best >= 70 ? 'high' : best >= 45 ? 'medium' : 'low');

  const bSum = await getMatchSummaries(db, B, [opp]);
  assert.equal(bSum[opp]!.score, rows.find((m) => m.companyId === B)!.score);
  assert.deepEqual(await getMatchSummaries(db, C, [opp]), {}, 'empresa sem nota não enxerga a de outra');
  assert.deepEqual(await getMatchSummaries(db, A, []), {});
  await assert.rejects(getMatchSummaries(db, A, Array.from({ length: MAX_SUMMARY_IDS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)), RangeError);

  // perfil desativado deixa de contar
  const a1score = rows.find((m) => m.searchProfileId === a1)!.score;
  await db.update(s.searchProfiles).set({ active: false }).where(eq(s.searchProfiles.id, a1));
  const afterOff = await getMatchSummaries(db, A, [opp]);
  assert.equal(afterOff[opp]!.score, rows.find((m) => m.searchProfileId === a2)!.score);
  assert.ok(afterOff[opp]!.score < a1score);
});

test('worker: match.score está registrado e roda pelo registro (payload validado)', async () => {
  const registry = buildRegistry({ pool, boss: {} as PgBoss, connectors: new Map() });
  assert.ok(registry.names().includes('match.score'));
  const ctx = { jobId: 'j', retryCount: 0, signal: new AbortController().signal };
  await db.delete(s.matchScores).where(eq(s.matchScores.opportunityId, opp));
  await registry.run('match.score', { opportunityId: opp, companyId: B }, ctx);
  assert.deepEqual((await rowsFor()).filter((m) => m.companyId === B).length, 1);
  assert.ok(!(await rowsFor()).some((m) => m.companyId === A), 'só a empresa do payload foi pontuada');
  await assert.rejects(registry.run('match.score', { opportunityId: 'lixo' }, ctx), /payload inválido/);
});

/* ------------------- descarte rápido (primeira varredura: dezenas de milhares de oportunidades) ------------------- */

/** Counts the SQL statements a block sends through the pool. */
async function captureSql<T>(fn: () => Promise<T>): Promise<{ result: T; statements: string[] }> {
  const statements: string[] = [];
  const original = pool.query.bind(pool) as (...a: unknown[]) => unknown;
  (pool as unknown as { query: unknown }).query = (...args: unknown[]) => {
    const first = args[0];
    statements.push(typeof first === 'string' ? first : String((first as { text?: string }).text ?? ''));
    return original(...args);
  };
  try {
    return { result: await fn(), statements };
  } finally {
    (pool as unknown as { query: unknown }).query = original;
  }
}

test('descarte rápido: UF, modalidade, faixa de valor e termos fora → nada é gravado e poucas consultas', async () => {
  const D = await company('D', 4, 'active');
  const dUf = await profile(D, { name: 'uf', ufs: ['SP'] });
  const dMod = await profile(D, { name: 'modalidade', modalityCodes: [4] });
  const dMin = await profile(D, { name: 'valor mínimo', minValue: '500000' });
  const dMax = await profile(D, { name: 'valor máximo', maxValue: '100000' });
  const dTerms = await profile(D, { name: 'termos', includeTerms: ['merenda escolar'] });
  const { result, statements } = await captureSql(() => scoreOpportunity(db, { opportunityId: opp, companyId: D }));
  assert.deepEqual({ eligible: result.eligible, discarded: result.discarded, written: result.written, removed: result.removed }, { eligible: 0, discarded: 5, written: 0, removed: 0 });
  assert.equal((await db.select().from(s.matchScores).where(eq(s.matchScores.companyId, D))).length, 0);
  // opportunity, profiles, items (only because of the terms profile) and the existing-scores probe
  assert.ok(statements.length <= 4, `consultas demais: ${statements.length}\n${statements.join('\n')}`);
  assert.ok(!statements.some((q) => /^\s*(insert|update|delete)/i.test(q)), 'descartar não pode gravar');
  void [dUf, dMod, dMin, dMax, dTerms];

  // Without the terms profile the cheap filters end the job before touching items.
  await db.delete(s.searchProfiles).where(eq(s.searchProfiles.id, dTerms));
  const quick = await captureSql(() => scoreOpportunity(db, { opportunityId: opp, companyId: D }));
  assert.ok(quick.statements.length <= 3, `consultas demais: ${quick.statements.length}`);
  assert.ok(!quick.statements.some((q) => /opportunity_items/i.test(q)), 'itens não são lidos quando os filtros já descartam');
});

test('valor desconhecido ou sigiloso e UF/modalidade desconhecidas não descartam (na dúvida, mantém)', async () => {
  const E = await company('E', 5, 'active');
  const e1 = await profile(E, { ufs: ['SP'], modalityCodes: [4], minValue: '500000' });
  const [unknown] = await db
    .insert(s.opportunities)
    .values({ canonicalKey: `pncp:mt${run}-2026-7`, primarySourceId: src, title: 'Adequação à LGPD', objectDescription: 'Consultoria para adequação à LGPD', agencyName: 'Prefeitura Fictícia', sphere: 'municipal', status: 'receiving_proposals', url: 'https://pncp.gov.br/u', contentHash: hash, confidentialBudget: true })
    .returning({ id: s.opportunities.id });
  const r = await scoreOpportunity(db, { opportunityId: unknown!.id, companyId: E });
  assert.deepEqual({ eligible: r.eligible, written: r.written }, { eligible: 1, written: 1 });
  assert.ok((await db.select().from(s.matchScores).where(eq(s.matchScores.searchProfileId, e1))).length === 1);
});

test('termos só nos itens: mantém o perfil (lê os itens antes de descartar); sem termo em lugar nenhum, descarta', async () => {
  const F = await company('F', 6, 'active');
  const hit = await profile(F, { name: 'notebook', includeTerms: ['notebook'], ufs: [], modalityCodes: [] });
  const miss = await profile(F, { name: 'impressora', includeTerms: ['impressora'], ufs: [], modalityCodes: [] });
  const [o2] = await db
    .insert(s.opportunities)
    .values({ canonicalKey: `pncp:mt${run}-2026-8`, primarySourceId: src, title: 'Pregão 12/2026', objectDescription: 'Aquisição de equipamentos para as secretarias', agencyName: 'Prefeitura Fictícia', sphere: 'municipal', status: 'receiving_proposals', uf: 'RN', url: 'https://pncp.gov.br/z', contentHash: hash })
    .returning({ id: s.opportunities.id });
  await db.insert(s.opportunityItems).values({ opportunityId: o2!.id, number: 1, description: 'Notebook 14 polegadas, 16 GB RAM', kind: 'material', quantity: '10', unit: 'UN' });
  const r = await scoreOpportunity(db, { opportunityId: o2!.id, companyId: F });
  assert.deepEqual({ eligible: r.eligible, discarded: r.discarded, written: r.written }, { eligible: 1, discarded: 1, written: 1 });
  const rows = await db.select().from(s.matchScores).where(eq(s.matchScores.opportunityId, o2!.id));
  assert.deepEqual(rows.map((m) => m.searchProfileId), [hit]);
  assert.ok(!rows.some((m) => m.searchProfileId === miss));
});

test('a oportunidade mudou e o perfil deixou de casar: a nota antiga é removida; volta a casar → regrava', async () => {
  await db.update(s.searchProfiles).set({ active: true }).where(eq(s.searchProfiles.id, a1)); // an earlier test deactivated it
  await scoreOpportunity(db, { opportunityId: opp, companyId: A }, new Date(Date.now() + 9 * MAX_SCORE_AGE_MS));
  assert.equal((await rowsFor()).filter((m) => m.searchProfileId === a1).length, 1, 'ponto de partida');
  await db.update(s.opportunities).set({ uf: 'SP', contentHash: 'f'.repeat(64) }).where(eq(s.opportunities.id, opp));
  const gone = await scoreOpportunity(db, { opportunityId: opp, companyId: A }, new Date(Date.now() + 9 * MAX_SCORE_AGE_MS + 1_000));
  assert.equal(gone.removed, 1, 'a1 (UF RN) deixou de casar');
  assert.ok(!(await rowsFor()).some((m) => m.searchProfileId === a1));
  assert.ok((await rowsFor()).some((m) => m.searchProfileId === a2), 'perfil nacional continua casando');
  await db.update(s.opportunities).set({ uf: 'RN', contentHash: hash }).where(eq(s.opportunities.id, opp));
  const back = await scoreOpportunity(db, { opportunityId: opp, companyId: A }, new Date(Date.now() + 9 * MAX_SCORE_AGE_MS + 2_000));
  assert.ok(back.written >= 1);
  assert.ok((await rowsFor()).some((m) => m.searchProfileId === a1));
});

/* ------------------- T-305b: nota irrelevante (no_term_match / excluded_term) não é gravada ------------------- */

const opportunityRow = (n: number, over: Partial<typeof s.opportunities.$inferInsert>) => ({
  canonicalKey: `pncp:mt${run}-2026-b${n}`,
  primarySourceId: src,
  title: 'Pregão',
  objectDescription: 'x',
  agencyName: 'Prefeitura Fictícia',
  sphere: 'municipal' as const,
  status: 'receiving_proposals' as const,
  uf: 'RN' as const,
  url: 'https://pncp.gov.br/b',
  contentHash: hash,
  ...over,
});

test('T-305b: sem categoria Nett (no_term_match) ou com termo excluído (excluded_term) não grava nota', async () => {
  const G = await company('G', 7, 'active');
  const pTerms = await profile(G, { name: 'serviços', includeTerms: ['serviços'], ufs: [], modalityCodes: [] });
  const pFood = await profile(G, { name: 'merenda', includeTerms: ['merenda'], ufs: [], modalityCodes: [] });
  const pExcl = await profile(G, { name: 'exclui', includeTerms: ['lgpd'], excludeTerms: ['mapeamento de dados'], ufs: [], modalityCodes: [] });
  const [noCategory] = await db.insert(s.opportunities).values(opportunityRow(1, { objectDescription: 'Contratação de serviços diversos de apoio administrativo' })).returning({ id: s.opportunities.id });
  const [food] = await db.insert(s.opportunities).values(opportunityRow(2, { objectDescription: 'Aquisição de gêneros alimentícios para a merenda escolar' })).returning({ id: s.opportunities.id });
  const [lgpd] = await db.insert(s.opportunities).values(opportunityRow(3, { objectDescription: 'Consultoria para adequação à LGPD e mapeamento de dados pessoais' })).returning({ id: s.opportunities.id });
  const rows = (id: string) => db.select().from(s.matchScores).where(eq(s.matchScores.opportunityId, id));

  const a = await scoreOpportunity(db, { opportunityId: noCategory!.id, companyId: G });
  assert.deepEqual({ eligible: a.eligible, unmatched: a.unmatched, written: a.written }, { eligible: 1, unmatched: 1, written: 0 });
  assert.equal((await rows(noCategory!.id)).length, 0, 'no_term_match não grava');

  const b = await scoreOpportunity(db, { opportunityId: food!.id, companyId: G });
  assert.deepEqual({ unmatched: b.unmatched, written: b.written }, { unmatched: 1, written: 0 });
  assert.equal((await rows(food!.id)).length, 0, 'objeto excluído pelo dicionário não grava');

  const c = await scoreOpportunity(db, { opportunityId: lgpd!.id, companyId: G });
  assert.equal(c.written, 0, 'o perfil que exclui "mapeamento de dados" não grava');
  assert.equal((await rows(lgpd!.id)).filter((m) => m.searchProfileId === pExcl).length, 0);
  assert.equal(c.unmatched, 1);
  void [pTerms, pFood];
});

test('T-305b: nota antiga que passou a ter a trava é apagada; sem a trava, continua gravada', async () => {
  const H = await company('H', 8, 'active');
  const pid = await profile(H, { includeTerms: ['lgpd', 'merenda'], ufs: [], modalityCodes: [] });
  const [o] = await db.insert(s.opportunities).values(opportunityRow(4, { objectDescription: 'Consultoria para adequação à LGPD e mapeamento de dados pessoais' })).returning({ id: s.opportunities.id });
  const mine = () => db.select().from(s.matchScores).where(eq(s.matchScores.searchProfileId, pid));

  assert.equal((await scoreOpportunity(db, { opportunityId: o!.id, companyId: H })).written, 1);
  assert.equal((await mine()).length, 1, 'relevante → gravada');

  // the object changes to something the dictionary excludes: the stored score must go away
  await db.update(s.opportunities).set({ objectDescription: 'Aquisição de gêneros alimentícios para a merenda escolar', contentHash: '1'.repeat(64) }).where(eq(s.opportunities.id, o!.id));
  const gone = await scoreOpportunity(db, { opportunityId: o!.id, companyId: H }, new Date(Date.now() + 1_000));
  assert.deepEqual({ written: gone.written, unmatched: gone.unmatched, removed: gone.removed }, { written: 0, unmatched: 1, removed: 1 });
  assert.equal((await mine()).length, 0);

  // and it comes back when the opportunity becomes relevant again
  await db.update(s.opportunities).set({ objectDescription: 'Consultoria para adequação à LGPD e mapeamento de dados pessoais', contentHash: '2'.repeat(64) }).where(eq(s.opportunities.id, o!.id));
  assert.equal((await scoreOpportunity(db, { opportunityId: o!.id, companyId: H }, new Date(Date.now() + 2_000))).written, 1);
  assert.equal((await mine()).length, 1);
});

/* ------------------- contratos 1.4.0: categoria gravada, match.refresh, match.profile ------------------- */

test('primaryCategory é gravada no match.score e o getMatchSummaries lê a gravada (cálculo só para linha antiga)', async () => {
  const K = await company('K', 9, 'active');
  const pid = await profile(K, { ufs: [], modalityCodes: [] });
  const [o] = await db.insert(s.opportunities).values(opportunityRow(5, { objectDescription: 'Consultoria para adequação à LGPD e mapeamento de dados pessoais' })).returning({ id: s.opportunities.id });
  await scoreOpportunity(db, { opportunityId: o!.id, companyId: K });
  const row = () => db.select().from(s.matchScores).where(eq(s.matchScores.searchProfileId, pid)).then((r) => r[0]!);
  assert.equal((await row()).primaryCategory, 'lgpd');
  assert.equal((await getMatchSummaries(db, K, [o!.id]))[o!.id]!.primaryCategory, 'lgpd');

  // proves it reads the STORED value: a different stored category wins over what the text would give
  await db.update(s.matchScores).set({ primaryCategory: 'software' }).where(eq(s.matchScores.searchProfileId, pid));
  assert.equal((await getMatchSummaries(db, K, [o!.id]))[o!.id]!.primaryCategory, 'software');

  // legacy row (written before 1.4.0, no stored category): falls back to the derived one
  await db.update(s.matchScores).set({ primaryCategory: null }).where(eq(s.matchScores.searchProfileId, pid));
  assert.equal((await getMatchSummaries(db, K, [o!.id]))[o!.id]!.primaryCategory, 'lgpd');
});

type Sent = { opportunityId: string; companyId?: string };
const capture = () => {
  const sent: Sent[] = [];
  return { sent, deps: { db, enqueue: async (p: Sent) => void sent.push(p) } };
};

test('match.refresh: só oportunidades abertas com prazo na janela [-1 dia, +8 dias]', async () => {
  const L = await company('L', 1, 'active');
  await profile(L);
  const mk = async (n: number, over: Partial<typeof s.opportunities.$inferInsert>) => (await db.insert(s.opportunities).values(opportunityRow(100 + n, over)).returning({ id: s.opportunities.id }))[0]!.id;
  const now = new Date();
  const inWindow = await mk(1, { proposalsCloseAt: new Date(now.getTime() + 3 * day) });
  const justPast = await mk(2, { proposalsCloseAt: new Date(now.getTime() - 12 * 3_600_000) });
  const farAhead = await mk(3, { proposalsCloseAt: new Date(now.getTime() + 30 * day) });
  const longPast = await mk(4, { proposalsCloseAt: new Date(now.getTime() - 5 * day) });
  const noDeadline = await mk(5, { proposalsCloseAt: null });
  const closedInWindow = await mk(6, { status: 'closed', proposalsCloseAt: new Date(now.getTime() + 2 * day) });
  const cancelledInWindow = await mk(7, { status: 'cancelled', proposalsCloseAt: new Date(now.getTime() + 2 * day) });

  const { sent, deps } = capture();
  const r = await refreshOpenOpportunities(deps, now);
  const got = new Set(sent.map((x) => x.opportunityId));
  assert.ok(r.enqueued >= 2 && r.enqueued === sent.length);
  for (const id of [inWindow, justPast]) assert.ok(got.has(id), 'na janela');
  for (const id of [farAhead, longPast, noDeadline, closedInWindow, cancelledInWindow]) assert.ok(!got.has(id), 'fora da janela ou encerrada');
  assert.ok(sent.every((x) => x.companyId === undefined), 'refresh reavalia para todos os perfis');
});

test('match.profile: só abertas que o perfil pode casar; o filtro SQL é superconjunto do filtro em memória', async () => {
  const M = await company('M', 2, 'active');
  const pid = await profile(M, { ufs: ['RN'], modalityCodes: [6], minValue: '50000', maxValue: '400000', includeTerms: ['lgpd'] });
  const [pRow] = await db.select().from(s.searchProfiles).where(eq(s.searchProfiles.id, pid));
  const mk = async (n: number, over: Partial<typeof s.opportunities.$inferInsert>) =>
    (await db.insert(s.opportunities).values(opportunityRow(200 + n, { uf: 'RN', modalityCode: 6, estimatedValue: '100000', ...over })).returning())[0]!;
  const seeded = {
    match: await mk(1, {}),
    wrongUf: await mk(2, { uf: 'SP' }),
    wrongModality: await mk(3, { modalityCode: 4 }),
    tooCheap: await mk(4, { estimatedValue: '1000' }),
    tooExpensive: await mk(5, { estimatedValue: '900000' }),
    unknownUf: await mk(6, { uf: null }),
    unknownValue: await mk(7, { estimatedValue: null, confidentialBudget: true }),
    unknownModality: await mk(8, { modalityCode: null }),
    closed: await mk(9, { status: 'closed' }),
  };
  const { sent, deps } = capture();
  const r = await fanOutProfile(deps, pid);
  const got = new Set(sent.map((x) => x.opportunityId));
  assert.equal(r.enqueued, sent.length);
  assert.ok(sent.every((x) => x.companyId === M), 'cada job leva a empresa do perfil');
  for (const k of ['match', 'unknownUf', 'unknownValue', 'unknownModality'] as const) assert.ok(got.has(seeded[k].id), k);
  for (const k of ['wrongUf', 'wrongModality', 'tooCheap', 'tooExpensive', 'closed'] as const) assert.ok(!got.has(seeded[k].id), k);

  // SQL must never drop what the in-memory filter keeps (it would lose a match); it may keep more.
  for (const [k, o] of Object.entries(seeded)) {
    if (o.status !== 'receiving_proposals') continue;
    const kept = hardFilter({ uf: o.uf, modalityCode: o.modalityCode, estimatedValue: o.estimatedValue, title: o.title, objectDescription: o.objectDescription }, 'pncp', pRow!) === null;
    if (kept) assert.ok(got.has(o.id), `SQL descartou o que o filtro em memória mantém: ${k}`);
  }
});

test('match.profile: perfil inativo, empresa suspensa ou inexistente não enfileiram nada', async () => {
  const N = await company('N', 3, 'active');
  const S = await company('S', 4, 'suspended');
  const off = await profile(N, { active: false });
  const susp = await profile(S);
  for (const id of [off, susp, '00000000-0000-4000-8000-000000000000']) {
    const { sent, deps } = capture();
    assert.deepEqual(await fanOutProfile(deps, id), { enqueued: 0 });
    assert.equal(sent.length, 0);
  }
});

test('match.profile: pagina em lotes de 500 sem perder nem repetir (1100 oportunidades de uma fonte exclusiva)', async () => {
  const [source] = await db.insert(s.sources).values({ key: `mt_bulk_${run}`, name: 'Bulk', kind: 'api', rateLimit: { requestsPerMinute: 30, maxConcurrency: 3 } }).returning({ id: s.sources.id });
  createdSources.push(source!.id);
  const total = FANOUT_BATCH * 2 + 100;
  const ids: string[] = [];
  for (let i = 0; i < total; i += 550) {
    const rows = Array.from({ length: Math.min(550, total - i) }, (_, k) => opportunityRow(1000 + i + k, { primarySourceId: source!.id, canonicalKey: `pncp:bulk${run}-${i + k}`, uf: null }));
    ids.push(...(await db.insert(s.opportunities).values(rows).returning({ id: s.opportunities.id })).map((r) => r.id));
  }
  const O = await company('O', 5, 'active');
  const pid = await profile(O, { ufs: [], modalityCodes: [], sourceKeys: [`mt_bulk_${run}`] });
  const { sent, deps } = capture();
  const r = await fanOutProfile(deps, pid);
  assert.equal(r.enqueued, total);
  assert.equal(new Set(sent.map((x) => x.opportunityId)).size, total, 'sem repetição');
  assert.deepEqual(new Set(sent.map((x) => x.opportunityId)), new Set(ids), 'sem perda');
});

test('registro e agendamento: match.refresh e match.profile registrados; cron 05:10 por padrão e desligável', async () => {
  const registry = buildRegistry({ pool, boss: {} as PgBoss, connectors: new Map() });
  assert.ok(registry.names().includes('match.refresh') && registry.names().includes('match.profile'));
  assert.deepEqual(matchSchedules({}), [{ name: 'match.refresh', cron: '10 5 * * *', data: {} }]);
  assert.deepEqual(matchSchedules({ MATCH_REFRESH_CRON: '0 6 * * *' })[0]?.cron, '0 6 * * *');
  assert.deepEqual(matchSchedules({ MATCH_REFRESH_CRON: '' }), []);
});
