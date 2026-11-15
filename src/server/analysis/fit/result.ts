/**
 * Result payload of `AIAnalysis` with `kind = 'fit_assessment'` (delivered to Agent 04).
 *
 * PROPOSAL `fit-assessment/1.0.0`: `src/contracts/analysis.ts` only defines the `tender_summary`
 * result. A handoff asks Agent 01 to register this schema in the contracts; until then it lives
 * here and is validated before any write.
 *
 * Evidence status (pt-BR in UI): proven = comprovado · inferred = inferido · unverified = não verificado.
 */
import { z } from 'zod';
import { nettCategory } from './dictionary';

export const FIT_RESULT_SCHEMA_VERSION = 'fit-assessment/1.0.0' as const;

export const evidenceStatus = z.enum(['proven', 'inferred', 'unverified']);
export type EvidenceStatus = z.infer<typeof evidenceStatus>;

export const evidence = z.object({
  id: z.string(),
  status: evidenceStatus,
  /** Public tender Document id, or null for opportunity fields / company data / inferences. */
  documentId: z.string().nullable(),
  documentTitle: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  section: z.string().nullable(),
  /** Literal excerpt from the source (proven) or null. */
  quote: z.string().nullable(),
  rationale: z.string(),
});
export type Evidence = z.infer<typeof evidence>;

const refs = z.array(z.string());

export const reason = z.object({ code: z.string(), text: z.string(), status: evidenceStatus, evidence: refs });
export type Reason = z.infer<typeof reason>;

export const risk = z.object({
  code: z.string(),
  title: z.string(),
  level: z.enum(['high', 'medium', 'low']),
  description: z.string(),
  eliminatory: z.boolean(),
  evidence: refs,
});
export type Risk = z.infer<typeof risk>;

export const pendingItem = z.object({
  code: z.string(),
  description: z.string(),
  area: z.enum(['commercial', 'technical', 'legal', 'financial', 'documents']),
  evidence: refs,
});
export type PendingItem = z.infer<typeof pendingItem>;

export const factor = z.object({ key: z.string(), label: z.string(), points: z.number(), max: z.number(), detail: z.string(), evidence: refs });
export type Factor = z.infer<typeof factor>;

export const REQUIREMENT_TYPES = [
  'technical_attestation',
  'company_certification',
  'professional',
  'tax_regularity',
  'legal_qualification',
  'financial',
  'operational_capacity',
  'participation',
  'site_visit',
  'sample_poc',
] as const;
export const requirementType = z.enum(REQUIREMENT_TYPES);
export type RequirementType = z.infer<typeof requirementType>;

export const requirementSituation = z.enum(['met', 'met_declared', 'not_met', 'unverified']);
export type RequirementSituation = z.infer<typeof requirementSituation>;

export const assessedRequirement = z.object({
  id: z.string(),
  type: requirementType,
  description: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  eliminatory: z.boolean(),
  origin: z.enum(['rules', 'llm']),
  situation: requirementSituation,
  rationale: z.string(),
  evidence: refs,
});
export type AssessedRequirement = z.infer<typeof assessedRequirement>;

const band = z.enum(['high', 'medium', 'low']);

export const fitAssessmentResult = z.object({
  schemaVersion: z.literal(FIT_RESULT_SCHEMA_VERSION),
  opportunityId: z.string(),
  companyId: z.string(),
  generatedAt: z.string(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  versions: z.object({ engine: z.string(), dictionary: z.string(), weights: z.string(), prompt: z.string().nullable() }),
  commercial: z.object({
    score: z.number().int().min(0).max(100),
    band,
    primaryCategory: nettCategory.nullable(),
    categories: z.array(z.object({ category: nettCategory, label: z.string(), score: z.number().int().min(0).max(100), concepts: z.array(z.string()), evidence: refs })),
    factors: z.array(factor),
    caps: z.array(z.string()),
  }),
  qualification: z.object({
    /** null when no qualification requirement was found in the documents. */
    score: z.number().int().min(0).max(100).nullable(),
    band: band.nullable(),
    requirements: z.array(assessedRequirement),
    eliminatoryImpediments: z.array(z.string()),
  }),
  confidence: z.object({ level: band, value: z.number().min(0).max(1), rationale: z.array(z.string()) }),
  favorableReasons: z.array(reason),
  unfavorableReasons: z.array(reason),
  risks: z.array(risk),
  pendingItems: z.array(pendingItem),
  evidence: z.array(evidence),
  preliminaryRecommendation: z.object({
    decision: z.enum(['participate', 'evaluate', 'discard']),
    discardReasons: z.array(reason),
    rationale: z.string(),
    notice: z.string(),
  }),
  documentsAnalyzed: z.array(
    z.object({ documentId: z.string(), kind: z.string(), title: z.string(), pages: z.number().int(), pagesWithText: z.number().int(), unreadPages: z.array(z.number().int()) }),
  ),
  securityAlerts: z.array(z.object({ kind: z.literal('embedded_instruction'), documentId: z.string(), page: z.number().int(), excerpt: z.string() })),
  llm: z.object({ used: z.boolean(), calls: z.number().int(), discardedQuotes: z.number().int(), tokensIn: z.number().int(), tokensOut: z.number().int(), warnings: z.array(z.string()) }),
});
export type FitAssessmentResult = z.infer<typeof fitAssessmentResult>;
export type Decision = FitAssessmentResult['preliminaryRecommendation']['decision'];
