/**
 * T-304 integration with Postgres (DATABASE_URL_TEST, role nett_app, migrated database).
 * Not named *.test.ts on purpose: `npm run test:analysis` (no database) must not pick it up.
 * Run: npm run test:analysis:integration
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Db } from '../../db';
import * as s from '../../db/schema';
import { reviewInput, type ReviewInput } from '@/contracts/api/reviews';
import { AuthError } from '../../auth/errors';
import { authorizeCompany } from '../../auth/guard';
import type { Session } from '../../auth/session';
import { reviewsHandlers } from './handlers';
import { assertBidDecisionAuthorizes, createReview, effectiveReviewStatus, ReviewError } from './service';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST não configurada');
const pool = new Pool({ connectionString: url, max: 4 });
const db = drizzle(pool, { schema: s, casing: 'snake_case' }) as unknown as Db;
const run = Date.now().toString().slice(-9);
const hash = 'c'.repeat(64);
const RESULT = { datas: { fim: '30/11/2026' }, itens: [{ nome: 'a' }] };

let A: string, B: string, userA: string, userB: string, opp: string;
let privA: string, privB: string, pub: string, failed: string, superseded: string, score: string;
let profileId: string; // removed in `after`: an active profile left behind would affect other suites sharing the database

const input = (over: Record<string, unknown>): ReviewInput => reviewInput.parse({ decision: 'approved', ...over });
const rejects = (p: Promise<unknown>, code: string, status: number) =>
  assert.rejects(p, (e) => e instanceof ReviewError && e.code === code && e.status === status, `esperava ${code}/${status}`);

async function analysis(over: Partial<typeof s.aiAnalyses.$inferInsert>) {
  const [row] = await db
    .insert(s.aiAnalyses)
    .values({ opportunityId: opp, documentIds: [opp], kind: 'fit_assessment', promptVersion: 'rules', resultSchemaVersion: 'x', inputHash: hash, status: 'succeeded', result: RESULT, ...over })
    .returning({ id: s.aiAnalyses.id });
  return row!.id;
}

before(async () => {
  [{ id: A }, { id: B }] = (await db
    .insert(s.companies)
    .values([
      { legalName: 'Empresa A', cnpj: `31${run}0001`.slice(0, 14).padEnd(14, '0'), size: 'EPP' },
      { legalName: 'Empresa B', cnpj: `32${run}0002`.slice(0, 14).padEnd(14, '0'), size: 'ME' },
    ])
    .returning({ id: s.companies.id })) as [{ id: string }, { id: string }];
  [{ id: userA }, { id: userB }] = (await db
    .insert(s.userAccounts)
    .values([
      { keycloakSub: `rv-a-${run}`, email: 'a@exemplo.test', name: 'Consultor A' },
      { keycloakSub: `rv-b-${run}`, email: 'b@exemplo.test', name: 'Consultor B' },
    ])
    .returning({ id: s.userAccounts.id })) as [{ id: string }, { id: string }];
  const [src] = await db.insert(s.sources).values({ key: `rv_${run}`, name: 'PNCP', kind: 'api', rateLimit: { requestsPerMinute: 30, maxConcurrency: 3 } }).returning({ id: s.sources.id });
  [{ id: opp }] = await db
    .insert(s.opportunities)
    .values({ canonicalKey: `pncp:rv${run}-2026-1`, primarySourceId: src!.id, title: 't', objectDescription: 'o', agencyName: 'Prefeitura Fictícia', sphere: 'municipal', status: 'receiving_proposals', url: 'https://pncp.gov.br/x', contentHash: hash })
    .returning({ id: s.opportunities.id });
  privA = await analysis({ companyId: A });
  privB = await analysis({ companyId: B });
  pub = await analysis({ companyId: null, kind: 'tender_summary' });
  failed = await analysis({ companyId: A, status: 'failed', result: null });
  superseded = await analysis({ companyId: A, reviewStatus: 'superseded' });
  const [prof] = await db.insert(s.searchProfiles).values({ companyId: A, name: 'p', includeTerms: ['x'], ownerUserId: userA }).returning({ id: s.searchProfiles.id });
  profileId = prof!.id;
  [{ id: score }] = (await db
    .insert(s.matchScores)
    .values({ opportunityId: opp, companyId: A, searchProfileId: prof!.id, score: 80, factors: [], algorithmVersion: 'v1', opportunityContentHash: hash })
    .returning({ id: s.matchScores.id })) as [{ id: string }];
});
/**
 * Runs even when a test or `before` fails (node:test). Only the active SearchProfile is removed: companies, users and
 * analyses stay because human_reviews and audit_events are append-only by design (DELETE is revoked), and they
 * reference those rows. They are inert: nothing active points at them.
 */
after(async () => {
  try {
    if (profileId) await db.delete(s.searchProfiles).where(eq(s.searchProfiles.id, profileId));
  } finally {
    await pool.end();
  }
});

test('aprovar análise da empresa muda o reviewStatus, grava o parecer e a auditoria na mesma transação', async () => {
  const r = await createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'ai_analysis', subjectId: privA }), ctx: { ipHash: null, requestId: 'req-test-0001' } });
  assert.equal(r.reviewStatus, 'approved');
  assert.equal(r.review.reviewerUserId, userA);
  const [a] = await db.select({ st: s.aiAnalyses.reviewStatus }).from(s.aiAnalyses).where(eq(s.aiAnalyses.id, privA));
  assert.equal(a!.st, 'approved');
  const [ev] = await db.select().from(s.auditEvents).where(and(eq(s.auditEvents.entityId, r.review.id), eq(s.auditEvents.action, 'review.created')));
  assert.equal(ev!.actorUserId, userA);
  assert.deepEqual(ev!.metadata, { subjectType: 'ai_analysis', subjectId: privA, decision: 'approved', corrections: 0 });
});

test('o parecer mais recente define o status; HumanReview é append-only', async () => {
  const rej = await createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'ai_analysis', subjectId: privA, decision: 'rejected', comment: 'Valor fora do perfil' }) });
  assert.equal((await effectiveReviewStatus(db, A, privA)), 'rejected');
  const ch = await createReview(db, {
    companyId: A,
    reviewerUserId: userA,
    input: input({ subjectType: 'ai_analysis', subjectId: privA, decision: 'approved_with_changes', corrections: [{ path: 'datas.fim', previous: '30/11/2026', corrected: '01/12/2026', note: 'Errata' }] }),
  });
  assert.equal(ch.reviewStatus, 'approved_with_changes');
  assert.equal(await effectiveReviewStatus(db, A, privA), 'approved_with_changes');
  const total = await db.select({ id: s.humanReviews.id }).from(s.humanReviews).where(eq(s.humanReviews.subjectId, privA));
  assert.equal(total.length, 3);
  for (const stmt of [db.update(s.humanReviews).set({ decision: 'approved' }).where(eq(s.humanReviews.id, rej.review.id)), db.delete(s.humanReviews).where(eq(s.humanReviews.id, rej.review.id))])
    await assert.rejects(stmt, (e: { message?: string; cause?: { message?: string } }) => /permission denied|append-only|somente inclusão|imut/i.test(`${e.message} ${e.cause?.message}`));
});

test('correções: caminho inexistente, "previous" divergente, repetida ou sem mudança → 422; sem efeito colateral', async () => {
  const bad = (corrections: unknown[]) => createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'ai_analysis', subjectId: privA, decision: 'approved_with_changes', corrections }) });
  await rejects(bad([{ path: 'datas.inicio', previous: null, corrected: 'x' }]), 'INVALID_CORRECTION', 422);
  await rejects(bad([{ path: 'datas.fim', previous: 'errado', corrected: 'x' }]), 'INVALID_CORRECTION', 422);
  await rejects(bad([{ path: 'datas.fim', previous: '30/11/2026', corrected: '30/11/2026' }]), 'INVALID_CORRECTION', 422);
  await rejects(bad([{ path: 'datas.fim', previous: '30/11/2026', corrected: 'a' }, { path: 'datas.fim', previous: '30/11/2026', corrected: 'b' }]), 'INVALID_CORRECTION', 422);
  const total = await db.select({ id: s.humanReviews.id }).from(s.humanReviews).where(eq(s.humanReviews.subjectId, privA));
  assert.equal(total.length, 3);
});

test('isolamento entre empresas: análise privada de outra empresa é 404, sem parecer e sem mudança de status', async () => {
  await rejects(createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'ai_analysis', subjectId: privB }) }), 'SUBJECT_NOT_FOUND', 404);
  await rejects(effectiveReviewStatus(db, A, privB), 'SUBJECT_NOT_FOUND', 404);
  const [b] = await db.select({ st: s.aiAnalyses.reviewStatus }).from(s.aiAnalyses).where(eq(s.aiAnalyses.id, privB));
  assert.equal(b!.st, 'pending_review');
  assert.equal((await db.select({ id: s.humanReviews.id }).from(s.humanReviews).where(eq(s.humanReviews.subjectId, privB))).length, 0);
  await rejects(createReview(db, { companyId: B, reviewerUserId: userB, input: input({ subjectType: 'match_score', subjectId: score }) }), 'SUBJECT_NOT_FOUND', 404);
});

test('análise pública: o parecer é por empresa e a linha compartilhada não muda', async () => {
  const ra = await createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'ai_analysis', subjectId: pub }) });
  const rb = await createReview(db, { companyId: B, reviewerUserId: userB, input: input({ subjectType: 'ai_analysis', subjectId: pub, decision: 'rejected', comment: 'Fora do escopo' }) });
  assert.equal(ra.reviewStatus, 'approved');
  assert.equal(rb.reviewStatus, 'rejected');
  const [row] = await db.select({ st: s.aiAnalyses.reviewStatus }).from(s.aiAnalyses).where(eq(s.aiAnalyses.id, pub));
  assert.equal(row!.st, 'pending_review');
  assert.equal(await effectiveReviewStatus(db, A, pub), 'approved');
  assert.equal(await effectiveReviewStatus(db, B, pub), 'rejected');
});

test('análise não concluída ou substituída não é revisável; corrections só para ai_analysis', async () => {
  await rejects(createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'ai_analysis', subjectId: failed }) }), 'SUBJECT_NOT_REVIEWABLE', 409);
  await rejects(createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'ai_analysis', subjectId: superseded }) }), 'SUBJECT_NOT_REVIEWABLE', 409);
  await rejects(createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'bid_decision', subjectId: opp, decision: 'approved_with_changes', corrections: [{ path: 'a', previous: 1, corrected: 2 }] }) }), 'CORRECTIONS_NOT_SUPPORTED', 422);
  await rejects(createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'bid_decision', subjectId: '00000000-0000-4000-8000-000000000000' }) }), 'SUBJECT_NOT_FOUND', 404);
  const ok = await createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'match_score', subjectId: score }) });
  assert.equal(ok.reviewStatus, null);
});

test('reviews concorrentes da mesma análise serializam e o status final bate com o último parecer', async () => {
  const id = await analysis({ companyId: A });
  const jobs = ['approved', 'rejected', 'approved', 'rejected', 'approved'].map((decision) =>
    createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'ai_analysis', subjectId: id, decision, comment: decision === 'rejected' ? 'motivo' : null }) }),
  );
  await Promise.all(jobs);
  const [last] = await db.select({ d: s.humanReviews.decision }).from(s.humanReviews).where(eq(s.humanReviews.subjectId, id)).orderBy(sql`created_at desc, id desc`).limit(1);
  const [row] = await db.select({ st: s.aiAnalyses.reviewStatus }).from(s.aiAnalyses).where(eq(s.aiAnalyses.id, id));
  assert.equal(row!.st, last!.d);
});

test('assertBidDecisionAuthorizes: só parecer aprovado, da empresa e da oportunidade, sem rejeição posterior', async () => {
  const p = (reviewId: string, companyId = A) => assertBidDecisionAuthorizes(db, { companyId, opportunityId: opp, reviewId });
  const approved = await createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'bid_decision', subjectId: opp }) });
  await p(approved.review.id);
  await rejects(p(approved.review.id, B), 'BID_DECISION_INVALID', 422);
  const other = await createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'match_score', subjectId: score }) });
  await rejects(p(other.review.id), 'BID_DECISION_INVALID', 422);
  await rejects(p('00000000-0000-4000-8000-000000000000'), 'BID_DECISION_INVALID', 422);
  await createReview(db, { companyId: A, reviewerUserId: userA, input: input({ subjectType: 'bid_decision', subjectId: opp, decision: 'rejected', comment: 'Mudança de estratégia' }) });
  await rejects(p(approved.review.id), 'BID_DECISION_INVALID', 409);
  // O banco também protege o pipeline: stage >= proposal exige o parecer, da mesma empresa.
  await assert.rejects(db.insert(s.opportunityTrackings).values({ companyId: A, opportunityId: opp, stage: 'proposal' }), /bid_decision|check/i);
});

/* ------------------- rota (handlers exportados) com autorização real ------------------- */

const sessionOf = (userId: string): Session => ({ id: `sess-${userId}`, user: { id: userId, email: 'x@exemplo.test', name: 'X' }, realmRoles: [], expiresAt: new Date(Date.now() + 3_600_000) });
const handlersFor = (userId: string | null) =>
  reviewsHandlers({
    db: () => db,
    requireSession: async () => {
      if (!userId) throw new AuthError('UNAUTHENTICATED', 401, 'Sessão ausente ou expirada.');
      return sessionOf(userId);
    },
    authorize: (session, companyId, role) => authorizeCompany(db, session, companyId, role),
  });
const ctxOf = (companyId: string) => ({ params: Promise.resolve({ companyId }) });
const postReq = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) });
const getReq = (qs: Record<string, string>) => new Request(`http://localhost/x?${new URLSearchParams(qs)}`);

let consultantA: string, viewerA: string, consultantB: string;

test('rota: 401 sem sessão, 403 de outra empresa (com auditoria) e de leitor no POST; nada é gravado', async () => {
  [{ id: consultantA }, { id: viewerA }, { id: consultantB }] = (await db
    .insert(s.userAccounts)
    .values([
      { keycloakSub: `rt-ca-${run}`, email: 'ca@exemplo.test', name: 'Consultor A' },
      { keycloakSub: `rt-va-${run}`, email: 'va@exemplo.test', name: 'Leitor A' },
      { keycloakSub: `rt-cb-${run}`, email: 'cb@exemplo.test', name: 'Consultor B' },
    ])
    .returning({ id: s.userAccounts.id })) as [{ id: string }, { id: string }, { id: string }];
  await db.insert(s.memberships).values([
    { userId: consultantA, companyId: A, role: 'consultant' },
    { userId: viewerA, companyId: A, role: 'viewer' },
    { userId: consultantB, companyId: B, role: 'consultant' },
  ]);
  const target = await analysis({ companyId: A });
  const body = { subjectType: 'ai_analysis', subjectId: target, decision: 'approved' };
  const count = async () => (await db.select({ id: s.humanReviews.id }).from(s.humanReviews).where(eq(s.humanReviews.subjectId, target))).length;

  await assert.rejects(handlersFor(null).POST(postReq(body), ctxOf(A)), (e) => e instanceof AuthError && e.status === 401);
  await assert.rejects(handlersFor(consultantB).POST(postReq(body), ctxOf(A)), (e) => e instanceof AuthError && e.status === 403);
  await assert.rejects(handlersFor(viewerA).POST(postReq(body), ctxOf(A)), (e) => e instanceof AuthError && e.status === 403);
  await assert.rejects(handlersFor(consultantA).POST(postReq(body), ctxOf('lixo')), (e) => e instanceof AuthError && e.status === 403);
  assert.equal(await count(), 0);
  const denied = await db.select().from(s.auditEvents).where(and(eq(s.auditEvents.actorUserId, consultantB), eq(s.auditEvents.action, 'authz.denied')));
  assert.ok(denied.length >= 1);

  // 422 de corpo inválido só depois da autorização, e sem gravar
  assert.equal((await handlersFor(consultantA).POST(postReq({ ...body, decision: 'rejected' }), ctxOf(A))).status, 422);
  assert.equal(await count(), 0);

  const ok = await handlersFor(consultantA).POST(postReq(body), ctxOf(A));
  assert.equal(ok.status, 201);
  const created = (await ok.json()) as { review: { reviewerUserId: string }; reviewStatus: string };
  assert.equal(created.review.reviewerUserId, consultantA); // vem da sessão
  assert.equal(created.reviewStatus, 'approved');
  assert.equal(await count(), 1);
});

test('GET: leitor lista, ordem do mais recente, paginação por cursor sem repetir e isolamento entre empresas', async () => {
  const target = await analysis({ companyId: null, kind: 'tender_summary' });
  const makeA: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await createReview(db, { companyId: A, reviewerUserId: consultantA, input: input({ subjectType: 'ai_analysis', subjectId: target, decision: i % 2 ? 'approved' : 'rejected', comment: i % 2 ? null : `motivo ${i}` }) });
    makeA.push(r.review.id);
  }
  await createReview(db, { companyId: B, reviewerUserId: consultantB, input: input({ subjectType: 'ai_analysis', subjectId: target }) });

  const page = async (companyId: string, userId: string, qs: Record<string, string>) => {
    const res = await handlersFor(userId).GET(getReq({ subjectType: 'ai_analysis', subjectId: target, ...qs }), ctxOf(companyId));
    assert.equal(res.status, 200);
    return (await res.json()) as { items: { id: string; companyId: string }[]; nextCursor: string | null };
  };

  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const p = await page(A, viewerA, { limit: '2', ...(cursor ? { cursor } : {}) });
    assert.ok(p.items.every((i) => i.companyId === A));
    seen.push(...p.items.map((i) => i.id));
    cursor = p.nextCursor ?? undefined;
    pages++;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(seen, [...makeA].reverse());

  const b = await page(B, consultantB, {});
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0]!.companyId, B);
  await assert.rejects(handlersFor(consultantB).GET(getReq({ subjectType: 'ai_analysis', subjectId: target }), ctxOf(A)), (e) => e instanceof AuthError && e.status === 403);
});

/* ------------------- T-304b: "o parecer mais recente vale" sob concorrência ------------------- */

/** Write order = xmin order (each insert is serialized by the advisory lock, so xids are assigned in lock order). The database sorts, so microseconds are kept. */
async function writeOrder(subjectId: string) {
  const q = async (order: string) => (await db.execute(sql.raw(`select id, decision from human_reviews where subject_id = '${subjectId}' order by ${order}`))).rows as { id: string; decision: string }[];
  const byWrite = await q('xmin::text::bigint asc');
  const byCreated = await q('created_at asc, id asc');
  return { byWrite, byCreated, lastWritten: byWrite.at(-1)! };
}

test('concorrência: createdAt segue a ordem de gravação e o último gravado vence (análise pública e bid_decision)', async () => {
  const target = await analysis({ companyId: null, kind: 'tender_summary' });
  const [oppRow] = await db
    .insert(s.opportunities)
    .values({ canonicalKey: `pncp:rc${run}-2026-9`, primarySourceId: (await db.select({ id: s.sources.id }).from(s.sources).limit(1))[0]!.id, title: 't', objectDescription: 'o', agencyName: 'Prefeitura Fictícia', sphere: 'municipal', status: 'receiving_proposals', url: 'https://pncp.gov.br/y', contentHash: hash })
    .returning({ id: s.opportunities.id });
  for (const [subjectType, subjectId] of [['ai_analysis', target], ['bid_decision', oppRow!.id]] as const) {
    for (let round = 0; round < 3; round++) {
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          createReview(db, { companyId: A, reviewerUserId: consultantA, input: input({ subjectType, subjectId, decision: i % 2 ? 'approved' : 'rejected', comment: i % 2 ? null : `motivo ${round}-${i}` }) }),
        ),
      );
    }
    const { byWrite, byCreated, lastWritten } = await writeOrder(subjectId);
    assert.equal(byWrite.length, 36);
    assert.deepEqual(byCreated.map((r) => r.id), byWrite.map((r) => r.id), `${subjectType}: ordem por created_at difere da ordem de gravação`);
    if (subjectType === 'ai_analysis') {
      const expected = lastWritten.decision === 'rejected' ? 'rejected' : 'approved';
      assert.equal(await effectiveReviewStatus(db, A, subjectId), expected);
    } else {
      const [latest] = await db
        .select({ id: s.humanReviews.id })
        .from(s.humanReviews)
        .where(and(eq(s.humanReviews.companyId, A), eq(s.humanReviews.subjectId, subjectId)))
        .orderBy(sql`created_at desc, id desc`)
        .limit(1);
      assert.equal(latest!.id, lastWritten.id);
    }
  }
});
