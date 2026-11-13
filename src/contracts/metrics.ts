/**
 * ConsultantMetric — agregado DERIVADO, recalculável. Nunca editado manualmente.
 * Calculado pelo job `metrics.compute` (agente 04) a partir de OpportunityTracking, AIAnalysis e HumanReview.
 */
import { z } from 'zod';
import { decimal, isoDate, isoDateTime, uuid } from './common';

export const metricGranularity = z.enum(['day', 'week', 'month']);

export const consultantMetric = z.object({
  id: uuid,
  consultantUserId: uuid,
  /** null = consolidado de todas as empresas do consultor. */
  companyId: uuid.nullable(),
  granularity: metricGranularity,
  /** Início do período em America/Sao_Paulo. Único por (consultant, company, granularity, periodStart). */
  periodStart: isoDate,
  opportunitiesTriaged: z.number().int().nonnegative(),
  analysesRequested: z.number().int().nonnegative(),
  analysesReviewed: z.number().int().nonnegative(),
  /** Mediana de horas entre AIAnalysis.finishedAt e o primeiro HumanReview. */
  medianReviewLatencyHours: decimal.nullable(),
  bidsSubmitted: z.number().int().nonnegative(),
  bidsWon: z.number().int().nonnegative(),
  bidsLost: z.number().int().nonnegative(),
  valueSubmitted: decimal,
  valueWon: decimal,
  /** bidsWon / (bidsWon + bidsLost); null quando denominador = 0. */
  winRate: decimal.nullable(),
  computedAt: isoDateTime,
});
export type ConsultantMetric = z.infer<typeof consultantMetric>;
