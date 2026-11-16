/**
 * HumanReview (T-304) — registro humano append-only e regras de `AIAnalysis.reviewStatus`.
 *
 * Invariantes (CONTRACTS §2): a IA não decide; `reviewStatus` só muda por HumanReview; HumanReview nunca
 * é atualizado ou apagado (trigger + REVOKE no banco); `OpportunityTracking.stage >= proposal` exige
 * `bidDecisionReviewId`.
 *
 * Decisões desta implementação (propostas ao agente 01 no handoff):
 *  - `bid_decision.subjectId` = id da Opportunity (um parecer de decisão por empresa × oportunidade, o mais recente vale).
 *  - Análise pública (`companyId` null) é compartilhada: a revisão da empresa é gravada, mas o `reviewStatus`
 *    da linha compartilhada NÃO muda (não vaza decisão entre empresas); o status efetivo vem de `effectiveReviewStatus`.
 *  - Correções (`corrections`) só existem para `ai_analysis`; `previous` precisa ser igual ao valor atual do resultado.
 */
import { isDeepStrictEqual } from 'node:util';
import { and, desc, eq, sql } from 'drizzle-orm';
import { humanReview, type HumanReview } from '../../../contracts';
import { recordAudit } from '../../audit';
import type { Db } from '../../db';
import { aiAnalyses, humanReviews, matchScores, opportunities } from '../../db/schema';
import type { ReviewInput, ReviewListQuery } from '@/contracts/api/reviews';

export type ReviewErrorCode = 'INVALID_CURSOR' | 'SUBJECT_NOT_FOUND' | 'SUBJECT_NOT_REVIEWABLE' | 'INVALID_CORRECTION' | 'CORRECTIONS_NOT_SUPPORTED' | 'BID_DECISION_INVALID';

export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

type ReviewStatus = 'pending_review' | 'approved' | 'approved_with_changes' | 'rejected' | 'superseded';
type Decision = HumanReview['decision'];

/** approved → approved · approved_with_changes → approved_with_changes · rejected → rejected. */
export const STATUS_BY_DECISION: Record<Decision, Exclude<ReviewStatus, 'pending_review' | 'superseded'>> = {
  approved: 'approved',
  approved_with_changes: 'approved_with_changes',
  rejected: 'rejected',
};

/** Resolves `a.b[2].c` inside a JSON value. `found: false` when any segment is missing. */
export function resolvePath(root: unknown, path: string): { found: boolean; value?: unknown } {
  let cur: unknown = root;
  for (const m of path.matchAll(/([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]|\.([A-Za-z0-9_]+)/g)) {
    const key = m[1] ?? m[3];
    if (key !== undefined) {
      if (cur === null || typeof cur !== 'object' || Array.isArray(cur) || !Object.hasOwn(cur, key)) return { found: false };
      cur = (cur as Record<string, unknown>)[key];
    } else {
      const index = Number(m[2]);
      if (!Array.isArray(cur) || index >= cur.length) return { found: false };
      cur = cur[index];
    }
  }
  return { found: true, value: cur };
}

function checkCorrections(result: unknown, corrections: ReviewInput['corrections']) {
  const seen = new Set<string>();
  corrections.forEach((c, i) => {
    if (seen.has(c.path)) throw new ReviewError('INVALID_CORRECTION', 422, `corrections[${i}]: caminho repetido (${c.path})`);
    seen.add(c.path);
    const current = resolvePath(result, c.path);
    if (!current.found) throw new ReviewError('INVALID_CORRECTION', 422, `corrections[${i}]: caminho inexistente no resultado (${c.path})`);
    if (!isDeepStrictEqual(current.value ?? null, c.previous)) throw new ReviewError('INVALID_CORRECTION', 422, `corrections[${i}]: "previous" difere do valor atual de ${c.path}`);
    if (isDeepStrictEqual(c.previous, c.corrected)) throw new ReviewError('INVALID_CORRECTION', 422, `corrections[${i}]: "corrected" é igual a "previous"`);
  });
}

const notFound = (what: string) => new ReviewError('SUBJECT_NOT_FOUND', 404, `${what} não encontrado(a).`);

export type CreateReviewParams = {
  companyId: string;
  reviewerUserId: string;
  input: ReviewInput;
  ctx?: { ipHash: string | null; requestId: string | null };
};

export type CreatedReview = { review: HumanReview; reviewStatus: ReviewStatus | null };

/**
 * Creates the review, updates the analysis status (company-owned analyses only) and records the audit
 * event in ONE transaction. The analysis row is locked (`FOR UPDATE`) so concurrent reviews serialize.
 * Authorization (consultant+ in the company) is the caller's job — this function only enforces scope.
 */
export async function createReview(db: Db, { companyId, reviewerUserId, input, ctx }: CreateReviewParams): Promise<CreatedReview> {
  if (input.corrections.length > 0 && input.subjectType !== 'ai_analysis')
    throw new ReviewError('CORRECTIONS_NOT_SUPPORTED', 422, 'Correções só se aplicam a revisões de ai_analysis.');
  if (input.decision === 'approved_with_changes' && input.subjectType !== 'ai_analysis')
    throw new ReviewError('CORRECTIONS_NOT_SUPPORTED', 422, 'approved_with_changes só se aplica a revisões de ai_analysis.');

  return db.transaction(async (tx) => {
    // Serialize reviews of the same company × subject. Together with clock_timestamp() below this makes
    // "the most recent review wins" true: now() is the START of the transaction, so a review that started
    // earlier but committed later would otherwise sort as older. Lock order is always advisory → row.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`human_review:${companyId}:${input.subjectType}:${input.subjectId}`}, 0))`);
    let ownsAnalysisRow = false;
    if (input.subjectType === 'ai_analysis') {
      const [a] = await tx.select().from(aiAnalyses).where(eq(aiAnalyses.id, input.subjectId)).for('update');
      // Another tenant's private analysis is indistinguishable from a missing one.
      if (!a || (a.companyId !== null && a.companyId !== companyId)) throw notFound('Análise');
      if (a.status !== 'succeeded') throw new ReviewError('SUBJECT_NOT_REVIEWABLE', 409, 'Só análises concluídas podem ser revisadas.');
      if (a.reviewStatus === 'superseded') throw new ReviewError('SUBJECT_NOT_REVIEWABLE', 409, 'Análise substituída por uma mais recente.');
      checkCorrections(a.result, input.corrections);
      ownsAnalysisRow = a.companyId === companyId;
    } else if (input.subjectType === 'match_score') {
      const [m] = await tx.select({ id: matchScores.id }).from(matchScores).where(and(eq(matchScores.id, input.subjectId), eq(matchScores.companyId, companyId)));
      if (!m) throw notFound('Aderência');
    } else {
      const [o] = await tx.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.id, input.subjectId));
      if (!o) throw notFound('Oportunidade');
    }

    const [row] = await tx
      .insert(humanReviews)
      .values({ companyId, subjectType: input.subjectType, subjectId: input.subjectId, reviewerUserId, decision: input.decision, corrections: input.corrections, comment: input.comment, createdAt: sql`clock_timestamp()` })
      .returning();
    if (!row) throw new Error('human_reviews: insert não retornou linha');

    let reviewStatus: ReviewStatus | null = null;
    if (input.subjectType === 'ai_analysis') {
      reviewStatus = STATUS_BY_DECISION[input.decision];
      // The row is locked, so this review is the latest. Shared (public) analyses keep their status.
      if (ownsAnalysisRow) await tx.update(aiAnalyses).set({ reviewStatus }).where(eq(aiAnalyses.id, input.subjectId));
    }

    await recordAudit(tx, {
      action: 'review.created',
      outcome: 'success',
      actorUserId: reviewerUserId,
      companyId,
      entityType: 'human_review',
      entityId: row.id,
      ipHash: ctx?.ipHash ?? null,
      requestId: ctx?.requestId ?? null,
      // No comment or correction values: they may carry personal data.
      metadata: { subjectType: input.subjectType, subjectId: input.subjectId, decision: input.decision, corrections: input.corrections.length },
    });

    const review = humanReview.parse({ ...row, createdAt: row.createdAt.toISOString() });
    return { review, reviewStatus };
  });
}

/** Review status of an analysis as seen by `companyId` (public analyses are per-company via human_reviews). */
export async function effectiveReviewStatus(db: Db, companyId: string, analysisId: string): Promise<ReviewStatus> {
  const [a] = await db.select({ companyId: aiAnalyses.companyId, reviewStatus: aiAnalyses.reviewStatus }).from(aiAnalyses).where(eq(aiAnalyses.id, analysisId));
  if (!a || (a.companyId !== null && a.companyId !== companyId)) throw notFound('Análise');
  if (a.companyId !== null || a.reviewStatus === 'superseded') return a.reviewStatus;
  const [last] = await db
    .select({ decision: humanReviews.decision })
    .from(humanReviews)
    .where(and(eq(humanReviews.companyId, companyId), eq(humanReviews.subjectType, 'ai_analysis'), eq(humanReviews.subjectId, analysisId)))
    .orderBy(desc(humanReviews.createdAt), desc(humanReviews.id))
    .limit(1);
  return last ? STATUS_BY_DECISION[last.decision] : 'pending_review';
}

/**
 * Gate for the pipeline API (agent 04): may `reviewId` authorize moving `opportunityId` to `proposal` or later?
 * Valid when it is a bid_decision of this company for this opportunity, approved (with or without changes),
 * and not revoked by a LATER rejection of the same company × opportunity. Throws ReviewError otherwise.
 */
export async function assertBidDecisionAuthorizes(db: Db | Pick<Db, 'select'>, p: { companyId: string; opportunityId: string; reviewId: string }): Promise<void> {
  const [r] = await db.select().from(humanReviews).where(and(eq(humanReviews.id, p.reviewId), eq(humanReviews.companyId, p.companyId)));
  if (!r || r.subjectType !== 'bid_decision' || r.subjectId !== p.opportunityId) throw new ReviewError('BID_DECISION_INVALID', 422, 'Parecer de decisão inexistente para esta empresa e oportunidade.');
  if (r.decision === 'rejected') throw new ReviewError('BID_DECISION_INVALID', 422, 'O parecer registrado rejeita a participação.');
  const [latest] = await db
    .select({ id: humanReviews.id, decision: humanReviews.decision })
    .from(humanReviews)
    .where(and(eq(humanReviews.companyId, p.companyId), eq(humanReviews.subjectType, 'bid_decision'), eq(humanReviews.subjectId, p.opportunityId)))
    .orderBy(desc(humanReviews.createdAt), desc(humanReviews.id))
    .limit(1);
  if (latest && latest.id !== r.id && latest.decision === 'rejected') throw new ReviewError('BID_DECISION_INVALID', 409, 'Um parecer mais recente rejeitou a participação.');
}

const CURSOR_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque keyset cursor over (created_at, id). The timestamp is the database's own text, so microseconds survive. */
export const encodeCursor = (ts: string, id: string) => Buffer.from(JSON.stringify([ts, id])).toString('base64url');

export function decodeCursor(cursor: string): { ts: string; id: string } {
  try {
    const [ts, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [unknown, unknown];
    if (typeof ts === 'string' && typeof id === 'string' && CURSOR_TS.test(ts) && UUID.test(id)) return { ts, id };
  } catch {
    /* falls through */
  }
  throw new ReviewError('INVALID_CURSOR', 422, 'Cursor inválido.');
}

/** Reviews of one subject made by `companyId`, newest first. Other companies' reviews are never returned. */
export async function listReviews(db: Db, companyId: string, q: ReviewListQuery): Promise<{ items: HumanReview[]; nextCursor: string | null }> {
  const after = q.cursor ? decodeCursor(q.cursor) : null;
  const rows = await db
    .select({ row: humanReviews, ts: sql<string>`${humanReviews.createdAt}::text` })
    .from(humanReviews)
    .where(
      and(
        eq(humanReviews.companyId, companyId),
        eq(humanReviews.subjectType, q.subjectType),
        eq(humanReviews.subjectId, q.subjectId),
        after ? sql`(${humanReviews.createdAt}, ${humanReviews.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(humanReviews.createdAt), desc(humanReviews.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ row }) => humanReview.parse({ ...row, createdAt: row.createdAt.toISOString() })),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.ts, last.row.id) : null,
  };
}
