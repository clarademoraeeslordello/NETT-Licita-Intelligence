/**
 * AIAnalysis, HumanReview e MatchScore.
 * Escrita: agente 03 (src/server/analysis, src/server/matching). HumanReview via API do agente 03, UI do agente 04.
 */
import { z } from 'zod';
import { analiseSchema } from '../lib/schema';
import { decimal, isoDateTime, sha256, uuid } from './common';

/* ------------------------------- AIAnalysis ------------------------------ */

export const analysisKind = z.enum(['tender_summary', 'fit_assessment', 'risk_review']);
export const analysisStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const analysisEngine = z.enum(['llm', 'local_rules']);
export const reviewStatus = z.enum(['pending_review', 'approved', 'approved_with_changes', 'rejected', 'superseded']);

/** Resultado por tipo. `tender_summary` reaproveita o schema de evidências do LicitaFlow (found/inferred/not_found). */
export const tenderSummaryResult = analiseSchema;

export const aiAnalysis = z.object({
  id: uuid,
  opportunityId: uuid,
  /**
   * null => análise só de documentos públicos; pode ser reutilizada por qualquer empresa (cache por inputHash).
   * !null => usa dados da empresa; visível apenas para ela.
   */
  companyId: uuid.nullable(),
  documentIds: z.array(uuid).min(1),
  kind: analysisKind,
  status: analysisStatus,
  engine: analysisEngine.nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  promptVersion: z.string(),
  resultSchemaVersion: z.string(),
  /** sha256(kind + promptVersion + model + sha256 dos documentos [+ dados da empresa]). Chave de cache. */
  inputHash: sha256,
  /** Validado contra o schema do `kind` (ex.: tenderSummaryResult) antes de gravar. */
  result: z.unknown().nullable(),
  confidence: z.enum(['high', 'medium', 'low']).nullable(),
  warnings: z.array(z.string()),
  tokensIn: z.number().int().nonnegative().nullable(),
  tokensOut: z.number().int().nonnegative().nullable(),
  costUsd: decimal.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** Derivado do HumanReview mais recente. Nunca escrito diretamente pela IA. */
  reviewStatus,
  requestedByUserId: uuid.nullable(),
  queuedAt: isoDateTime,
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
});
export type AIAnalysis = z.infer<typeof aiAnalysis>;

/* ------------------------------- MatchScore ------------------------------ */

export const matchFactor = z.object({
  key: z.enum(['object', 'region', 'value', 'deadline', 'modality', 'capability', 'certificates']),
  label: z.string(),
  points: z.number(),
  max: z.number(),
  detail: z.string(),
});

/** Aderência Opportunity × empresa × SearchProfile. Herda a nota auditável 0–100 do LicitaFlow. */
export const matchScore = z.object({
  id: uuid,
  opportunityId: uuid,
  companyId: uuid,
  searchProfileId: uuid,
  score: z.number().int().min(0).max(100),
  factors: z.array(matchFactor),
  /** Travas aplicadas, ex.: "excluded_term", "cancelled", "no_term_match". */
  caps: z.array(z.string()),
  algorithmVersion: z.string(),
  opportunityContentHash: sha256,
  computedAt: isoDateTime,
});
export type MatchScore = z.infer<typeof matchScore>;

/* ------------------------------- HumanReview ----------------------------- */

export const reviewSubject = z.enum(['ai_analysis', 'match_score', 'bid_decision']);
export const reviewDecision = z.enum(['approved', 'approved_with_changes', 'rejected']);

/**
 * Registro APPEND-ONLY de revisão humana. Obrigatório antes de qualquer decisão de participar
 * (bid_decision) e para promover uma AIAnalysis a "approved".
 */
export const humanReview = z
  .object({
    id: uuid,
    companyId: uuid,
    subjectType: reviewSubject,
    subjectId: uuid,
    reviewerUserId: uuid,
    decision: reviewDecision,
    corrections: z.array(
      z.object({
        /** Caminho JSON no resultado, ex.: "datas.encerramentoPropostas". */
        path: z.string(),
        previous: z.unknown(),
        corrected: z.unknown(),
        note: z.string().nullable(),
      }),
    ),
    comment: z.string().nullable(),
    createdAt: isoDateTime,
  })
  .refine((r) => r.decision !== 'approved_with_changes' || r.corrections.length > 0, {
    message: 'approved_with_changes exige corrections',
  })
  .refine((r) => r.decision !== 'rejected' || (r.comment ?? '').trim().length > 0, {
    message: 'rejected exige comment',
  });
export type HumanReview = z.infer<typeof humanReview>;
