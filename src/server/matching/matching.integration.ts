/**
 * T-305 integration with Postgres (DATABASE_URL_TEST, role nett_app, migrated database).
 * Run: npm run test:analysis:integration
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { matchScore } from '../../contracts';
import type { Db } from '../db';
import * as s from '../db/schema';
import { buildRegistry } from '../jobs/handlers';
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

const company = async (n: string, digit: number, status: 'active' | 'suspended') =>
  (await db.insert(s.companies).values({ legalName: `Empresa ${n}`, cnpj: `4${digit}${run}000`.slice(0, 14).padEnd(14, '0'), size: 'EPP', status }).returning({ id: s.companies.id }))[0]!.id;
const profile = async (companyId: string, over: Partial<typeof s.searchProfiles.$inferInsert> = {}) =>
  (await db.insert(s.searchProfiles).values({ companyId, name: 'p', includeTerms: ['lgpd'], ownerUserId: user, ufs: ['RN'], modalityCodes: [6], ...over }).returning({ id: s.searchProfiles.id }))[0]!.id;
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
  a2 = await profile(A, { name: 'fora', ufs: ['SP'] });
  a3 = await profile(A, { name: 'inativo', active: false });
  a4 = await profile(A, { name: 'outra fonte', sourceKeys: [`mt_other_${run}`] });
  b1 = await profile(B, { ufs: [] });
  c1 = await profile(C);
});
after(() => pool.end());

test('uma nota por SearchProfile ativo de empresa ativa; inativo, outra fonte e empresa suspensa ficam de fora', async () => {
  // Without companyId it scores every active profile in the database (the shared test database may hold others).
  const r = await scoreOpportunity(db, { opportunityId: opp });
  assert.ok(r.opportunityFound && r.written >= 3);
  const mine = new Set([A, B, C]);
  const rows = (await rowsFor()).filter((m) => mine.has(m.companyId));
  assert.deepEqual(rows.map((m) => m.searchProfileId).sort(), [a1, a2, b1].sort());
  for (const absent of [a3, a4, c1]) assert.ok(!rows.some((m) => m.searchProfileId === absent));
  const sc = (id: string) => rows.find((m) => m.searchProfileId === id)!;
  assert.ok(sc(a1).score > sc(a2).score, 'UF dentro da área pontua mais que fora');
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
  assert.deepEqual({ profiles: only.profiles, written: only.written }, { profiles: 1, written: 1 });
  const ghost = await scoreOpportunity(db, { opportunityId: '00000000-0000-4000-8000-000000000000' });
  assert.deepEqual(ghost, { opportunityFound: false, profiles: 0, written: 0, skipped: 0 });
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
