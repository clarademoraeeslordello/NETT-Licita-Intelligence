/**
 * CompanyCapability, SearchProfile e OpportunityTracking — dados PRIVADOS da empresa (company_id obrigatório).
 * CompanyCapability/SearchProfile: API do agente 03. OpportunityTracking (pipeline): API do agente 04.
 */
import { z } from 'zod';
import { decimal, isoDate, isoDateTime, timestamps, uf, uuid } from './common';

/* --------------------------- CompanyCapability --------------------------- */

export const capabilityKind = z.enum([
  'product',
  'service',
  'certification',
  'technical_attestation',
  'license',
  'geographic_coverage',
  'financial_capacity',
]);

export const companyCapability = z.object({
  id: uuid,
  companyId: uuid,
  kind: capabilityKind,
  name: z.string().min(1),
  description: z.string(),
  keywords: z.array(z.string().min(1)),
  /** Códigos CATMAT/CATSER quando conhecidos. */
  catalogCodes: z.array(z.string()),
  ufs: z.array(uf),
  maxContractValue: decimal.nullable(),
  /** Documento que comprova (atestado, certidão, licença). */
  evidenceDocumentId: uuid.nullable(),
  validUntil: isoDate.nullable(),
  active: z.boolean(),
  ...timestamps,
});
export type CompanyCapability = z.infer<typeof companyCapability>;

/* ----------------------------- SearchProfile ----------------------------- */

/** Evolução do `PerfilAderencia` do LicitaFlow, agora no servidor e por empresa. */
export const searchProfile = z
  .object({
    id: uuid,
    companyId: uuid,
    name: z.string().min(1),
    includeTerms: z.array(z.string().min(1)).min(1),
    excludeTerms: z.array(z.string().min(1)),
    /** Vazio = abrangência nacional. */
    ufs: z.array(uf),
    modalityCodes: z.array(z.number().int()),
    minValue: decimal.nullable(),
    maxValue: decimal.nullable(),
    /** Vazio = todas as fontes habilitadas. */
    sourceKeys: z.array(z.string()),
    /** Nota mínima para entrar no radar e gerar alerta. */
    minScore: z.number().int().min(0).max(100),
    alertChannel: z.enum(['none', 'in_app', 'email']),
    ownerUserId: uuid,
    active: z.boolean(),
    ...timestamps,
  })
  .refine((p) => p.minValue === null || p.maxValue === null || Number(p.minValue) <= Number(p.maxValue), {
    message: 'minValue deve ser <= maxValue',
  });
export type SearchProfile = z.infer<typeof searchProfile>;

/* --------------------------- OpportunityTracking ------------------------- */

/** Etapas herdadas do pipeline do LicitaFlow. */
export const pipelineStage = z.enum(['triage', 'analysis', 'documentation', 'proposal', 'dispute', 'result']);

export const opportunityTracking = z.object({
  id: uuid,
  companyId: uuid,
  opportunityId: uuid,
  stage: pipelineStage,
  assignedConsultantId: uuid.nullable(),
  proposalValue: decimal.nullable(),
  outcome: z.enum(['won', 'lost', 'withdrawn']).nullable(),
  /** HumanReview(subjectType = bid_decision) que autorizou disputar. Obrigatório a partir de `proposal`. */
  bidDecisionReviewId: uuid.nullable(),
  notes: z.string(),
  discardedAt: isoDateTime.nullable(),
  ...timestamps,
});
export type OpportunityTracking = z.infer<typeof opportunityTracking>;
