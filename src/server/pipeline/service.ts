/**
 * Pipeline persistido (OpportunityTracking) e cofre de certidões (só metadados) — T-406, agente 04.
 * Autorização por empresa é do chamador (handlers); aqui toda consulta já filtra por `companyId`.
 * Regra de negócio única: etapa >= proposal exige parecer de decisão aprovado (`assertBidDecisionAuthorizes`, agente 03).
 * Certidão: grava só `kind`, `title` e o bloco `certificate`; nunca campos do arquivo (CONTRACTS §2, linha Document).
 */
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { recordAudit } from '../audit';
import { badRequest, conflict, HttpError, notFound, unprocessable } from '../http/errors';
import { assertBidDecisionAuthorizes, ReviewError } from '../analysis/reviews/service';
import type { Db } from '../db';
import { aiAnalyses, documents, humanReviews, memberships, opportunities, opportunityTrackings } from '../db/schema';
import type { RequestContext } from '../http/request';
import {
  STAGES_NEED_DECISION,
  type CertificateCreateInput,
  type CertificateUpdateInput,
  type TrackingCreateInput,
  type TrackingUpdateInput,
} from './dto';

type Actor = { companyId: string; userId: string; ctx?: Partial<RequestContext> };

const auditBase = (a: Actor) => ({ outcome: 'success' as const, actorUserId: a.userId, companyId: a.companyId, ipHash: a.ctx?.ipHash ?? null, requestId: a.ctx?.requestId ?? null });
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/* --------------------------------- pipeline -------------------------------- */

export type TrackingRow = typeof opportunityTrackings.$inferSelect;

export function trackingDto(t: TrackingRow) {
  return {
    id: t.id,
    companyId: t.companyId,
    opportunityId: t.opportunityId,
    stage: t.stage,
    assignedConsultantId: t.assignedConsultantId,
    proposalValue: t.proposalValue,
    outcome: t.outcome,
    bidDecisionReviewId: t.bidDecisionReviewId,
    notes: t.notes,
    discardedAt: iso(t.discardedAt),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
export type TrackingDto = ReturnType<typeof trackingDto>;

export type TrackingCard = {
  tracking: TrackingDto;
  opportunity: {
    id: string;
    title: string;
    agencyName: string;
    uf: string | null;
    modalityName: string | null;
    proposalsCloseAt: string | null;
    estimatedValue: string | null;
    url: string;
  };
  /** Parecer de decisão mais recente da empresa para a oportunidade (vale o último, CONTRACTS §2.8). */
  latestBidDecision: { id: string; decision: 'approved' | 'approved_with_changes' | 'rejected'; createdAt: string } | null;
  /** Análise concluída mais recente visível à empresa (pública ou da própria empresa), para abrir a revisão. */
  latestAnalysis: { id: string; kind: 'tender_summary' | 'fit_assessment' | 'risk_review' } | null;
};

export async function listTrackings(db: Db, companyId: string, q: { includeDiscarded: boolean; limit: number }): Promise<{ items: TrackingCard[]; truncated: boolean }> {
  const rows = await db
    .select({ t: opportunityTrackings, o: opportunities })
    .from(opportunityTrackings)
    .innerJoin(opportunities, eq(opportunities.id, opportunityTrackings.opportunityId))
    .where(and(eq(opportunityTrackings.companyId, companyId), q.includeDiscarded ? undefined : isNull(opportunityTrackings.discardedAt)))
    .orderBy(desc(opportunityTrackings.updatedAt), desc(opportunityTrackings.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);

  const latest = new Map<string, TrackingCard['latestBidDecision']>();
  if (page.length > 0) {
    const reviews = await db
      .select({ id: humanReviews.id, subjectId: humanReviews.subjectId, decision: humanReviews.decision, createdAt: humanReviews.createdAt })
      .from(humanReviews)
      .where(and(eq(humanReviews.companyId, companyId), eq(humanReviews.subjectType, 'bid_decision'), inArray(humanReviews.subjectId, page.map((r) => r.o.id))))
      .orderBy(desc(humanReviews.createdAt), desc(humanReviews.id));
    for (const r of reviews) if (!latest.has(r.subjectId)) latest.set(r.subjectId, { id: r.id, decision: r.decision, createdAt: r.createdAt.toISOString() });
  }

  const analyses = new Map<string, NonNullable<TrackingCard['latestAnalysis']>>();
  if (page.length > 0) {
    const found = await db
      .select({ id: aiAnalyses.id, opportunityId: aiAnalyses.opportunityId, kind: aiAnalyses.kind })
      .from(aiAnalyses)
      .where(and(inArray(aiAnalyses.opportunityId, page.map((r) => r.o.id)), eq(aiAnalyses.status, 'succeeded'), or(isNull(aiAnalyses.companyId), eq(aiAnalyses.companyId, companyId))))
      .orderBy(desc(aiAnalyses.finishedAt), desc(aiAnalyses.id));
    for (const r of found) if (!analyses.has(r.opportunityId)) analyses.set(r.opportunityId, { id: r.id, kind: r.kind });
  }

  return {
    truncated: rows.length > q.limit,
    items: page.map(({ t, o }) => ({
      tracking: trackingDto(t),
      opportunity: {
        id: o.id,
        title: o.title,
        agencyName: o.agencyName,
        uf: o.uf,
        modalityName: o.modalityName,
        proposalsCloseAt: iso(o.proposalsCloseAt),
        estimatedValue: o.estimatedValue,
        url: o.url,
      },
      latestBidDecision: latest.get(o.id) ?? null,
      latestAnalysis: analyses.get(o.id) ?? null,
    })),
  };
}

export async function createTracking(db: Db, a: Actor, input: TrackingCreateInput): Promise<{ tracking: TrackingDto; reopened: boolean }> {
  return db.transaction(async (tx) => {
    const [o] = await tx.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.id, input.opportunityId));
    if (!o) throw notFound('Oportunidade não encontrada.');

    const [created] = await tx
      .insert(opportunityTrackings)
      .values({ companyId: a.companyId, opportunityId: input.opportunityId, assignedConsultantId: a.userId, notes: input.notes ?? '' })
      .onConflictDoNothing()
      .returning();
    if (created) {
      await recordAudit(tx, { ...auditBase(a), action: 'pipeline.created', entityType: 'opportunity_tracking', entityId: created.id, metadata: { opportunityId: input.opportunityId } });
      return { tracking: trackingDto(created), reopened: false };
    }

    const [existing] = await tx
      .select()
      .from(opportunityTrackings)
      .where(and(eq(opportunityTrackings.companyId, a.companyId), eq(opportunityTrackings.opportunityId, input.opportunityId)))
      .for('update');
    if (!existing) throw conflict('Não foi possível adicionar ao pipeline; tente novamente.');
    if (!existing.discardedAt) throw conflict('Esta oportunidade já está no pipeline da empresa.', { trackingId: existing.id });
    const [reopened] = await tx
      .update(opportunityTrackings)
      .set({ discardedAt: null, stage: 'triage', outcome: null, ...(input.notes !== undefined ? { notes: input.notes } : {}) })
      .where(eq(opportunityTrackings.id, existing.id))
      .returning();
    if (!reopened) throw new Error('opportunity_trackings: update não retornou linha');
    await recordAudit(tx, { ...auditBase(a), action: 'pipeline.reopened', entityType: 'opportunity_tracking', entityId: existing.id, metadata: { opportunityId: input.opportunityId } });
    return { tracking: trackingDto(reopened), reopened: true };
  });
}

/** Troca o erro do serviço de revisão (agente 03) pelo erro HTTP comum. */
async function assertDecision(tx: Pick<Db, 'select'>, p: { companyId: string; opportunityId: string; reviewId: string }) {
  try {
    await assertBidDecisionAuthorizes(tx, p);
  } catch (e) {
    if (e instanceof ReviewError) throw new HttpError(e.code, e.status, e.message);
    throw e;
  }
}

export async function updateTracking(db: Db, a: Actor, trackingId: string, input: TrackingUpdateInput): Promise<TrackingDto> {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(opportunityTrackings)
      .where(and(eq(opportunityTrackings.id, trackingId), eq(opportunityTrackings.companyId, a.companyId)))
      .for('update');
    if (!t) throw notFound('Acompanhamento não encontrado.');

    const stage = input.stage ?? t.stage;
    const reviewId = input.bidDecisionReviewId !== undefined ? input.bidDecisionReviewId : t.bidDecisionReviewId;
    const stageChanged = stage !== t.stage;
    const reviewChanged = reviewId !== t.bidDecisionReviewId;

    // O parecer é conferido ao entrar numa etapa que o exige ou ao trocar o parecer; edições de nota não reabrem a regra.
    if (STAGES_NEED_DECISION.has(stage) && (stageChanged || reviewChanged)) {
      if (!reviewId) throw unprocessable('Esta etapa exige um parecer de decisão aprovado (bidDecisionReviewId).');
      await assertDecision(tx, { companyId: a.companyId, opportunityId: t.opportunityId, reviewId });
    }

    if (input.outcome && stage !== 'result') throw unprocessable('O resultado só pode ser informado na etapa "result".');
    if (input.assignedConsultantId) {
      const [m] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.companyId, a.companyId), eq(memberships.userId, input.assignedConsultantId)));
      if (!m) throw unprocessable('O responsável precisa ter vínculo com a empresa.');
    }

    const discardChanged = input.discarded !== undefined && input.discarded !== (t.discardedAt !== null);
    const [row] = await tx
      .update(opportunityTrackings)
      .set({
        stage,
        bidDecisionReviewId: reviewId,
        // Sair de "result" limpa o resultado; fora dele nunca há resultado.
        outcome: stage === 'result' ? (input.outcome !== undefined ? input.outcome : t.outcome) : null,
        ...(input.assignedConsultantId !== undefined ? { assignedConsultantId: input.assignedConsultantId } : {}),
        ...(input.proposalValue !== undefined ? { proposalValue: input.proposalValue } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(discardChanged ? { discardedAt: input.discarded ? sql`now()` : null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(opportunityTrackings.id, t.id))
      .returning();
    if (!row) throw new Error('opportunity_trackings: update não retornou linha');

    const fields = Object.entries(input).filter(([, v]) => v !== undefined).map(([k]) => k);
    await recordAudit(tx, {
      ...auditBase(a),
      action: stageChanged ? 'pipeline.stage_changed' : discardChanged ? (input.discarded ? 'pipeline.discarded' : 'pipeline.reopened') : 'pipeline.updated',
      entityType: 'opportunity_tracking',
      entityId: t.id,
      // Sem notas nem valores: podem conter dado sensível.
      metadata: { opportunityId: t.opportunityId, from: t.stage, to: stage, fields },
    });
    return trackingDto(row);
  });
}

/* --------------------------- cofre de certidões (metadados) --------------------------- */

export type CertificateDto = {
  id: string;
  title: string;
  category: 'fiscal' | 'trabalhista' | 'juridica' | 'economica' | 'tecnica';
  issuer: string;
  issuedAt: string | null;
  validUntil: string | null;
  defaultValidityDays: number | null;
  issueUrl: string | null;
  /** O binário só entra por T-212; a chave do objeto nunca sai da API. */
  hasFile: boolean;
  createdAt: string;
  updatedAt: string;
};

type DocRow = typeof documents.$inferSelect;
export function certificateDto(d: DocRow): CertificateDto {
  const c = d.certificate;
  if (!c) throw new Error('documento company_certificate sem bloco certificate');
  return {
    id: d.id,
    title: d.title,
    category: c.category,
    issuer: c.issuer,
    issuedAt: c.issuedAt,
    validUntil: c.validUntil,
    defaultValidityDays: c.defaultValidityDays,
    issueUrl: c.issueUrl,
    hasFile: d.storageKey !== null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

const isCertificateOf = (companyId: string) => and(eq(documents.companyId, companyId), eq(documents.kind, 'company_certificate'));

export async function listCertificates(db: Db, companyId: string): Promise<{ items: CertificateDto[] }> {
  const rows = await db.select().from(documents).where(isCertificateOf(companyId)).orderBy(desc(documents.updatedAt), desc(documents.id)).limit(500);
  return { items: rows.map(certificateDto) };
}

export async function createCertificate(db: Db, a: Actor, input: CertificateCreateInput): Promise<CertificateDto> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        companyId: a.companyId,
        opportunityId: null,
        kind: 'company_certificate',
        origin: 'upload',
        title: input.title,
        mimeType: 'application/octet-stream', // provisório até T-212 (CONTRACTS §2)
        textStatus: 'pending',
        uploadedByUserId: a.userId,
        certificate: { category: input.category, issuer: input.issuer, issuedAt: input.issuedAt, validUntil: input.validUntil, defaultValidityDays: input.defaultValidityDays, issueUrl: input.issueUrl },
      })
      .returning();
    if (!row) throw new Error('documents: insert não retornou linha');
    await recordAudit(tx, { ...auditBase(a), action: 'document.certificate_created', entityType: 'document', entityId: row.id, metadata: { category: input.category } });
    return certificateDto(row);
  });
}

export async function updateCertificate(db: Db, a: Actor, id: string, input: CertificateUpdateInput): Promise<CertificateDto> {
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(documents).where(and(eq(documents.id, id), isCertificateOf(a.companyId))).for('update');
    if (!d || !d.certificate) throw notFound('Certidão não encontrada.');
    const { title, ...patch } = input;
    const certificate = { ...d.certificate, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    if (certificate.issuedAt && certificate.validUntil && certificate.issuedAt > certificate.validUntil) throw badRequest('validUntil não pode ser anterior a issuedAt.');
    const [row] = await tx
      .update(documents)
      .set({ certificate, ...(title !== undefined ? { title } : {}), updatedAt: sql`now()` })
      .where(eq(documents.id, d.id))
      .returning();
    if (!row) throw new Error('documents: update não retornou linha');
    await recordAudit(tx, { ...auditBase(a), action: 'document.certificate_updated', entityType: 'document', entityId: d.id, metadata: { fields: Object.keys(input) } });
    return certificateDto(row);
  });
}
