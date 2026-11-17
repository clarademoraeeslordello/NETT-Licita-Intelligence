/**
 * T-406 integração com Postgres (DATABASE_URL_TEST, papel nett_app, banco migrado).
 * Fora do padrão *.test.ts de propósito: `npm run test:pipeline` (sem banco) não a executa.
 * Rodar: npm run test:pipeline:integration
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { HttpError } from '../http/errors';
import type { Db } from '../db';
import * as s from '../db/schema';
import { createReview } from '../analysis/reviews/service';
import { reviewInput } from '@/contracts/api/reviews';
import { certificateCreateInput, trackingCreateInput, trackingUpdateInput } from './dto';
import { createCertificate, createTracking, listCertificates, listTrackings, updateCertificate, updateTracking } from './service';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST não configurada');
const pool = new Pool({ connectionString: url, max: 4 });
const db = drizzle(pool, { schema: s, casing: 'snake_case' }) as unknown as Db;
const run = Date.now().toString().slice(-9);
const hash = 'd'.repeat(64);

let A: string, B: string, userA: string, userB: string, outsider: string, opp: string, opp2: string;
const actor = (companyId: string, userId: string) => ({ companyId, userId });
const rejects = (p: Promise<unknown>, status: number, code?: string) =>
  assert.rejects(p, (e) => e instanceof HttpError && e.status === status && (!code || e.code === code), `esperava ${status}${code ? `/${code}` : ''}`);
const bid = (companyId: string, opportunityId: string, decision: 'approved' | 'rejected') =>
  createReview(db, { companyId, reviewerUserId: userA, input: reviewInput.parse({ subjectType: 'bid_decision', subjectId: opportunityId, decision, comment: decision === 'rejected' ? 'sem interesse' : undefined }) });

before(async () => {
  [{ id: A }, { id: B }] = (await db
    .insert(s.companies)
    .values([
      { legalName: 'Empresa PA', cnpj: `41${run}0001`.slice(0, 14).padEnd(14, '0'), size: 'EPP' },
      { legalName: 'Empresa PB', cnpj: `42${run}0002`.slice(0, 14).padEnd(14, '0'), size: 'ME' },
    ])
    .returning({ id: s.companies.id })) as [{ id: string }, { id: string }];
  [{ id: userA }, { id: userB }, { id: outsider }] = (await db
    .insert(s.userAccounts)
    .values([
      { keycloakSub: `pl-a-${run}`, email: 'a@exemplo.test', name: 'Consultor A' },
      { keycloakSub: `pl-b-${run}`, email: 'b@exemplo.test', name: 'Consultor B' },
      { keycloakSub: `pl-c-${run}`, email: 'c@exemplo.test', name: 'Sem vínculo' },
    ])
    .returning({ id: s.userAccounts.id })) as [{ id: string }, { id: string }, { id: string }];
  await db.insert(s.memberships).values([
    { userId: userA, companyId: A, role: 'consultant' },
    { userId: userB, companyId: B, role: 'consultant' },
  ]);
  const [src] = await db.insert(s.sources).values({ key: `pl_${run}`, name: 'PNCP', kind: 'api', rateLimit: { requestsPerMinute: 30, maxConcurrency: 3 } }).returning({ id: s.sources.id });
  const base = { primarySourceId: src!.id, title: 't', objectDescription: 'o', agencyName: 'Prefeitura Fictícia', sphere: 'municipal' as const, status: 'receiving_proposals' as const, url: 'https://pncp.gov.br/x', contentHash: hash };
  [{ id: opp }, { id: opp2 }] = (await db
    .insert(s.opportunities)
    .values([
      { ...base, canonicalKey: `pncp:pl${run}-2026-1` },
      { ...base, canonicalKey: `pncp:pl${run}-2026-2` },
    ])
    .returning({ id: s.opportunities.id })) as [{ id: string }, { id: string }];
});

after(async () => {
  await db.delete(s.opportunityTrackings).where(inArray(s.opportunityTrackings.companyId, [A, B]));
  await pool.end();
});

test('cria na triagem, impede duplicata e reabre após descarte', async () => {
  const { tracking, reopened } = await createTracking(db, actor(A, userA), trackingCreateInput.parse({ opportunityId: opp, notes: 'olhar o prazo' }));
  assert.equal(tracking.stage, 'triage');
  assert.equal(tracking.notes, 'olhar o prazo');
  assert.equal(reopened, false);
  await rejects(createTracking(db, actor(A, userA), trackingCreateInput.parse({ opportunityId: opp })), 409);
  await updateTracking(db, actor(A, userA), tracking.id, trackingUpdateInput.parse({ discarded: true }));
  assert.equal((await listTrackings(db, A, { includeDiscarded: false, limit: 50 })).items.length, 0);
  assert.equal((await listTrackings(db, A, { includeDiscarded: true, limit: 50 })).items.length, 1);
  const again = await createTracking(db, actor(A, userA), trackingCreateInput.parse({ opportunityId: opp }));
  assert.equal(again.reopened, true);
  assert.equal(again.tracking.discardedAt, null);
});

test('oportunidade inexistente → 404', async () => {
  await rejects(createTracking(db, actor(A, userA), trackingCreateInput.parse({ opportunityId: '0190f5e2-7c1a-7cc3-9d2b-00000000dead' })), 404);
});

test('isolamento: outra empresa não vê nem altera o acompanhamento (404)', async () => {
  const [mine] = (await listTrackings(db, A, { includeDiscarded: false, limit: 50 })).items;
  assert.equal((await listTrackings(db, B, { includeDiscarded: false, limit: 50 })).items.length, 0);
  await rejects(updateTracking(db, actor(B, userB), mine!.tracking.id, trackingUpdateInput.parse({ notes: 'invasão' })), 404);
});

test('proposal/dispute/result exigem parecer aprovado; rejeição posterior revoga; avançar audita', async () => {
  const [card] = (await listTrackings(db, A, { includeDiscarded: false, limit: 50 })).items;
  const id = card!.tracking.id;
  await rejects(updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ stage: 'proposal' })), 422);
  const rejected = await bid(A, opp, 'rejected');
  await rejects(updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ stage: 'proposal', bidDecisionReviewId: rejected.review.id })), 422, 'BID_DECISION_INVALID');
  const approved = await bid(A, opp, 'approved');
  // parecer de outra oportunidade não vale
  const other = await bid(A, opp2, 'approved');
  await rejects(updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ stage: 'proposal', bidDecisionReviewId: other.review.id })), 422, 'BID_DECISION_INVALID');
  const moved = await updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ stage: 'proposal', bidDecisionReviewId: approved.review.id, proposalValue: '1500.25' }));
  assert.equal(moved.stage, 'proposal');
  assert.equal(Number(moved.proposalValue), 1500.25);
  const [audit] = await db.select().from(s.auditEvents).where(and(eq(s.auditEvents.action, 'pipeline.stage_changed'), eq(s.auditEvents.entityId, id)));
  assert.ok(audit, 'evento de auditoria da mudança de etapa');
  assert.deepEqual((audit!.metadata as { from: string; to: string }).to, 'proposal');
  // editar nota depois de um parecer rejeitado mais recente não trava a edição (regra só na entrada da etapa)
  await bid(A, opp, 'rejected');
  assert.equal((await updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ notes: 'ok' }))).notes, 'ok');
  // mas entrar em outra etapa que exige parecer, com o parecer revogado, falha
  await rejects(updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ stage: 'dispute' })), 409, 'BID_DECISION_INVALID');
});

test('resultado só em "result"; sair de "result" limpa o resultado; responsável precisa de vínculo', async () => {
  const [card] = (await listTrackings(db, A, { includeDiscarded: false, limit: 50 })).items;
  const id = card!.tracking.id;
  const fresh = await bid(A, opp, 'approved');
  await rejects(updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ outcome: 'won' })), 422);
  const done = await updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ stage: 'result', bidDecisionReviewId: fresh.review.id, outcome: 'won' }));
  assert.equal(done.outcome, 'won');
  const back = await updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ stage: 'documentation' }));
  assert.equal(back.outcome, null);
  await rejects(updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ assignedConsultantId: outsider })), 422);
  assert.equal((await updateTracking(db, actor(A, userA), id, trackingUpdateInput.parse({ assignedConsultantId: userA }))).assignedConsultantId, userA);
});

test('cofre: grava só metadados, nunca campos do arquivo; renova; isola por empresa', async () => {
  const created = await createCertificate(db, actor(A, userA), certificateCreateInput.parse({ title: 'CND Federal', category: 'fiscal', issuer: 'Receita Federal', issuedAt: '2026-11-01', validUntil: '2027-05-01' }));
  assert.equal(created.hasFile, false);
  const [row] = await db.select().from(s.documents).where(eq(s.documents.id, created.id));
  assert.equal(row!.kind, 'company_certificate');
  assert.equal(row!.companyId, A);
  assert.equal(row!.storageKey, null);
  assert.equal(row!.sha256, null);
  assert.equal(row!.sizeBytes, null);
  assert.equal(row!.mimeType, 'application/octet-stream');

  const renewed = await updateCertificate(db, actor(A, userA), created.id, { issuedAt: '2027-04-20', validUntil: '2027-10-20' });
  assert.equal(renewed.validUntil, '2027-10-20');
  assert.equal(renewed.issuer, 'Receita Federal');
  await rejects(updateCertificate(db, actor(A, userA), created.id, { validUntil: '2027-01-01' }), 400);
  await rejects(updateCertificate(db, actor(B, userB), created.id, { title: 'invasão' }), 404);
  assert.equal((await listCertificates(db, B)).items.length, 0);
  assert.equal((await listCertificates(db, A)).items.length, 1);
  assert.ok(!('storageKey' in renewed));
});
