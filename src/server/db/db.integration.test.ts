/**
 * Integração com Postgres real (T-101). Requer banco descartável já migrado e:
 *   DATABASE_URL_TEST (papel nett_app)
 * Executar: npm run test:db
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as s from './schema';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST não configurada');
const pool = new Pool({ connectionString: url, max: 2 });
const db: NodePgDatabase<typeof s> = drizzle(pool, { schema: s, casing: 'snake_case' });
const hash = 'b'.repeat(64);
const run = Date.now().toString().slice(-8);

let companyA: string, companyB: string, user: string, source: string, opp: string;

/** Erro do pg vem embrulhado pelo Drizzle em `cause`. */
async function rejectsWith(fn: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(fn, (e: unknown) => {
    const err = e as { message?: string; cause?: { message?: string } };
    const msg = `${err.message ?? ''} ${err.cause?.message ?? ''}`;
    assert.match(msg, pattern);
    return true;
  });
}

before(async () => {
  [{ id: companyA }, { id: companyB }] = await db.insert(s.companies).values([
    { legalName: 'Empresa A', cnpj: `111${run}111`.slice(0, 14).padEnd(14, '0'), size: 'EPP' },
    { legalName: 'Empresa B', cnpj: `222${run}222`.slice(0, 14).padEnd(14, '0'), size: 'ME' },
  ]).returning({ id: s.companies.id });
  [{ id: user }] = await db.insert(s.userAccounts).values({ keycloakSub: `sub-${run}`, email: 'c@exemplo.test', name: 'Consultor' }).returning({ id: s.userAccounts.id });
  await db.insert(s.memberships).values({ userId: user, companyId: companyA, role: 'consultant' });
  [{ id: source }] = await db.insert(s.sources).values({ key: `pncp_${run}`, name: 'PNCP', kind: 'api', rateLimit: { requestsPerMinute: 30, maxConcurrency: 3 } }).returning({ id: s.sources.id });
  [{ id: opp }] = await db.insert(s.opportunities).values({
    canonicalKey: `pncp:${run}-2026-1`, primarySourceId: source, title: 'Notebooks', objectDescription: 'Aquisição de notebooks',
    agencyName: 'Prefeitura Fictícia', sphere: 'municipal', status: 'receiving_proposals', uf: 'RN', url: 'https://pncp.gov.br/x', contentHash: hash,
    estimatedValue: '123456.7890',
  }).returning({ id: s.opportunities.id });
});

after(async () => pool.end());

test('dinheiro volta como string decimal exata', async () => {
  const [row] = await db.select({ v: s.opportunities.estimatedValue }).from(s.opportunities).where(eq(s.opportunities.id, opp));
  assert.equal(row.v, '123456.7890');
});

test('canonicalKey é única e exige prefixo da fonte', async () => {
  const base = { primarySourceId: source, title: 't', objectDescription: 'o', agencyName: 'a', sphere: 'municipal' as const, status: 'published' as const, url: 'https://x', contentHash: hash };
  await rejectsWith(() => db.insert(s.opportunities).values({ ...base, canonicalKey: `pncp:${run}-2026-1` }), /opportunities_canonical_key_unique|duplicate key/);
  await rejectsWith(() => db.insert(s.opportunities).values({ ...base, canonicalKey: 'sem-prefixo' }), /opportunities_canonical_key_format/);
});

test('source_records: payload imutável, normalização atualizável, sem DELETE para a aplicação', async () => {
  const [rec] = await db.insert(s.sourceRecords).values({ sourceId: source, externalId: 'x1', payload: { a: 1 }, payloadHash: hash }).returning();
  await db.update(s.sourceRecords).set({ normalizationStatus: 'normalized', opportunityId: opp, normalizedAt: new Date() }).where(eq(s.sourceRecords.id, rec.id));
  await rejectsWith(() => db.update(s.sourceRecords).set({ payload: { a: 2 } }).where(eq(s.sourceRecords.id, rec.id)), /imutável/);
  await rejectsWith(() => db.delete(s.sourceRecords).where(eq(s.sourceRecords.id, rec.id)), /permission denied|imutável/);
});

test('human_reviews: append-only e regras de decisão', async () => {
  const [rev] = await db.insert(s.humanReviews).values({ companyId: companyA, subjectType: 'bid_decision', subjectId: opp, reviewerUserId: user, decision: 'approved' }).returning();
  await rejectsWith(() => db.update(s.humanReviews).set({ comment: 'x' }).where(eq(s.humanReviews.id, rev.id)), /permission denied|somente inclusão/);
  await rejectsWith(() => db.delete(s.humanReviews).where(eq(s.humanReviews.id, rev.id)), /permission denied|somente inclusão/);
  await rejectsWith(() => db.insert(s.humanReviews).values({ companyId: companyA, subjectType: 'ai_analysis', subjectId: opp, reviewerUserId: user, decision: 'rejected' }), /human_reviews_rejected_comment/);
  await rejectsWith(() => db.insert(s.humanReviews).values({ companyId: companyA, subjectType: 'ai_analysis', subjectId: opp, reviewerUserId: user, decision: 'approved_with_changes' }), /human_reviews_changes_corrections/);
});

test('pipeline: proposta exige decisão humana da MESMA empresa', async () => {
  await rejectsWith(() => db.insert(s.opportunityTrackings).values({ companyId: companyA, opportunityId: opp, stage: 'proposal' }), /opportunity_trackings_bid_decision/);
  const [revB] = await db.insert(s.humanReviews).values({ companyId: companyB, subjectType: 'bid_decision', subjectId: opp, reviewerUserId: user, decision: 'approved' }).returning();
  await rejectsWith(() => db.insert(s.opportunityTrackings).values({ companyId: companyA, opportunityId: opp, stage: 'proposal', bidDecisionReviewId: revB.id }), /opportunity_trackings_bid_review_fk/);
  const [revA] = await db.insert(s.humanReviews).values({ companyId: companyA, subjectType: 'bid_decision', subjectId: opp, reviewerUserId: user, decision: 'approved' }).returning();
  const [t] = await db.insert(s.opportunityTrackings).values({ companyId: companyA, opportunityId: opp, stage: 'proposal', bidDecisionReviewId: revA.id, proposalValue: '1000.50' }).returning();
  assert.equal(t.proposalValue, '1000.5000');
});

test('match_scores: perfil de outra empresa é rejeitado', async () => {
  const [pB] = await db.insert(s.searchProfiles).values({ companyId: companyB, name: 'B', includeTerms: ['notebook'], ownerUserId: user }).returning();
  await rejectsWith(() => db.insert(s.matchScores).values({ opportunityId: opp, companyId: companyA, searchProfileId: pB.id, score: 80, factors: [], algorithmVersion: 'v1', opportunityContentHash: hash }), /match_scores_profile_fk/);
  await rejectsWith(() => db.insert(s.searchProfiles).values({ companyId: companyA, name: 'x', includeTerms: [], ownerUserId: user }), /search_profiles_terms/);
});

test('documents: certidão exige empresa; chave privada no prefixo da empresa', async () => {
  await rejectsWith(() => db.insert(s.documents).values({ opportunityId: opp, kind: 'company_certificate', origin: 'upload', title: 'CND', mimeType: 'application/pdf' }), /documents_certificate/);
  await rejectsWith(() => db.insert(s.documents).values({ companyId: companyA, kind: 'proposal', origin: 'upload', title: 'P', mimeType: 'application/pdf', storageKey: `companies/${companyB}/a.pdf` }), /documents_private_key/);
  await rejectsWith(() => db.insert(s.documents).values({ opportunityId: opp, kind: 'tender_notice', origin: 'source', title: 'Edital', mimeType: 'application/pdf', storageKey: 'companies/x/a.pdf' }), /documents_public_key/);
  const [d] = await db.insert(s.documents).values({
    companyId: companyA, kind: 'company_certificate', origin: 'upload', title: 'CND', mimeType: 'application/pdf', storageKey: `companies/${companyA}/${run}.pdf`,
    certificate: { category: 'fiscal', issuer: 'RFB', issuedAt: '2026-11-01', validUntil: '2027-04-30', defaultValidityDays: 180, issueUrl: null },
  }).returning();
  assert.equal(d.certificate?.validUntil, '2027-04-30');
});

test('consultant_metrics: período único mesmo com companyId nulo', async () => {
  const row = { consultantUserId: user, companyId: null, granularity: 'month' as const, periodStart: '2026-11-01' };
  await db.insert(s.consultantMetrics).values(row);
  await rejectsWith(() => db.insert(s.consultantMetrics).values(row), /consultant_metrics_period_uq/);
});

test('aplicação não tem privilégio de DDL', async () => {
  await rejectsWith(() => db.execute(sql`create table ddl_proibido (id int)`), /permission denied/);
});
