/**
 * Fit assessment engine (Agent 03): Opportunity (Agent 02) + public documents + company data →
 * `fitAssessmentResult`, the `result` of an `AIAnalysis` with kind `fit_assessment` (Agent 04).
 * Pure: no database, no in-memory store. Persistence and queue (`analysis.run`) belong to T-303.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  aiAnalysis,
  company as companySchema,
  companyCapability,
  document as documentSchema,
  opportunity as opportunitySchema,
  opportunityItem,
  searchProfile as searchProfileSchema,
  type AIAnalysis,
  type Company,
  type CompanyCapability,
  type Document,
  type Opportunity,
  type OpportunityItem,
  type SearchProfile,
} from '../../../contracts';
import type { capabilityKind } from '../../../contracts';
import { classify, segmentsFromPassages, type Segment } from './classifier';
import { scoreCommercial } from './commercial';
import { NETT_DICTIONARY_V1, type Dictionary } from './dictionary';
import { EvidenceRegistry } from './evidence';
import { extractFindings } from './findings';
import { detectEmbeddedInstructions, hasEmbeddedInstruction } from './injection';
import { extractRequirementsWithLlm, FIT_PROMPT_VERSION, type JsonModel } from './llm';
import { buildPendingItems, buildReasons, buildRisks, computeConfidence, recommend } from './opinion';
import { assessQualification } from './qualification';
import { extractRequirements, reduceRequirements } from './requirements';
import { FIT_RESULT_SCHEMA_VERSION, fitAssessmentResult, type FitAssessmentResult } from './result';
import { segment, type FitDocument } from './sections';
import { ENGINE_VERSION, PRODUCTION_WEIGHTS, type Weights } from './weights';

type CapabilityKind = z.infer<typeof capabilityKind>;

export type FitAssessmentInput = {
  opportunity: Opportunity;
  items: OpportunityItem[];
  /** Public tender documents (companyId null) with extracted text per page (T-302). */
  documents: FitDocument[];
  company: Company;
  capabilities: CompanyCapability[];
  /** Documents with kind = company_certificate (the vault). */
  certificates: Document[];
  searchProfile: SearchProfile | null;
};

export type FitAssessmentOptions = {
  now?: Date;
  weights?: Weights;
  dictionary?: Dictionary;
  /** Optional LLM (public text only). Keep undefined until a provider is approved (P-04). */
  llm?: JsonModel;
  completeCapabilityKinds?: CapabilityKind[];
};

export class InvalidFitInput extends Error {
  constructor(public readonly issues: string[]) {
    super(`Entrada inválida para fit_assessment: ${issues.join('; ')}`);
    this.name = 'InvalidFitInput';
  }
}

const pagesSchema = z.array(z.object({ page: z.number().int().positive(), text: z.string().max(200_000) })).min(1).max(2_000);

/** Validates everything against the canonical contracts; input from other modules is untrusted. */
export function validateInput(input: FitAssessmentInput): FitAssessmentInput {
  const issues: string[] = [];
  const check = <T>(schema: z.ZodType<T>, value: unknown, path: string): T => {
    const r = schema.safeParse(value);
    if (!r.success) issues.push(...r.error.issues.map((i) => `${path}${i.path.length ? `.${i.path.join('.')}` : ''}: ${i.message}`));
    return (r.success ? r.data : value) as T;
  };
  const opp = check(opportunitySchema, input.opportunity, 'opportunity');
  input.items.forEach((it, i) => check(opportunityItem, it, `items[${i}]`));
  input.documents.forEach((d, i) => {
    check(documentSchema, d.document, `documents[${i}].document`);
    check(pagesSchema, d.pages, `documents[${i}].pages`);
    if (d.document.companyId !== null) issues.push(`documents[${i}]: documento privado não pode entrar como documento da licitação`);
    if (d.document.opportunityId !== opp.id) issues.push(`documents[${i}]: documento de outra oportunidade`);
  });
  const comp = check(companySchema, input.company, 'company');
  input.capabilities.forEach((c, i) => {
    check(companyCapability, c, `capabilities[${i}]`);
    if (c.companyId !== comp.id) issues.push(`capabilities[${i}]: capacidade de outra empresa`);
  });
  input.certificates.forEach((c, i) => {
    check(documentSchema, c, `certificates[${i}]`);
    if (c.companyId !== comp.id || c.kind !== 'company_certificate') issues.push(`certificates[${i}]: certidão inválida ou de outra empresa`);
  });
  if (input.searchProfile) {
    check(searchProfileSchema, input.searchProfile, 'searchProfile');
    if (input.searchProfile.companyId !== comp.id) issues.push('searchProfile: perfil de outra empresa');
  }
  if (issues.length) throw new InvalidFitInput(issues);
  return input;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Cache key per contract: kind + promptVersion + model + documents + company data. */
export function computeInputHash(input: FitAssessmentInput, versions: FitAssessmentResult['versions'], model: string | null): string {
  return sha256(
    JSON.stringify({
      kind: 'fit_assessment',
      versions,
      model,
      opportunity: input.opportunity.contentHash,
      items: input.items.map((i) => [i.number, i.description]),
      documents: input.documents.map((d) => d.document.sha256 ?? sha256(JSON.stringify(d.pages))),
      company: [input.company.id, input.company.size],
      capabilities: input.capabilities.map((c) => [c.id, c.updatedAt]),
      certificates: input.certificates.map((c) => [c.id, c.updatedAt]),
      profile: input.searchProfile ? [input.searchProfile.id, input.searchProfile.updatedAt] : null,
    }),
  );
}

export async function runFitAssessment(rawInput: FitAssessmentInput, options: FitAssessmentOptions = {}): Promise<FitAssessmentResult> {
  const input = validateInput(rawInput);
  const { opportunity: opp } = input;
  const now = options.now ?? new Date();
  const weights = options.weights ?? PRODUCTION_WEIGHTS;
  const dictionary = options.dictionary ?? NETT_DICTIONARY_V1;
  const registry = new EvidenceRegistry();

  // 1. Documents → traceable passages; embedded instructions are isolated, never followed.
  const passages = segment(input.documents);
  const alerts = detectEmbeddedInstructions(passages);
  const safe = passages.filter((p) => !hasEmbeddedInstruction(p.text));

  // 2. Semantic classification.
  const oppSegments: Segment[] = [
    { text: opp.objectDescription, weight: 1, origin: { type: 'opportunity', field: 'objectDescription' } },
    ...(opp.title ? [{ text: opp.title, weight: 0.8, origin: { type: 'opportunity' as const, field: 'title' } }] : []),
    ...input.items.map((it) => ({ text: it.description, weight: 0.9, origin: { type: 'opportunity' as const, field: `items[${it.number}]` } })),
  ];
  const docSegments = segmentsFromPassages(safe, dictionary);
  const objectSegments = [...oppSegments, ...docSegments.filter((s) => s.origin.type === 'passage' && s.origin.passage.sectionKind === 'object')];
  const classification = classify([...oppSegments, ...docSegments], dictionary, objectSegments, input.searchProfile?.excludeTerms ?? []);

  // 3. Requirements: deterministic rules + optional LLM with literal verification.
  let requirements = extractRequirements(safe);
  const llm = { used: false, calls: 0, discardedQuotes: 0, tokensIn: 0, tokensOut: 0, warnings: [] as string[] };
  if (options.llm && input.documents.length) {
    const r = await extractRequirementsWithLlm(input.documents, passages, options.llm);
    const accepted = r.requirements.filter((x) => x.passages.every((p) => !hasEmbeddedInstruction(p.text)));
    requirements = reduceRequirements([...requirements, ...accepted]);
    Object.assign(llm, { used: true, calls: r.calls, discardedQuotes: r.discarded + (r.requirements.length - accepted.length), tokensIn: r.tokensIn, tokensOut: r.tokensOut, warnings: r.warnings });
  }

  // 4. Independent assessments.
  const commercial = scoreCommercial(opp, classification, input.searchProfile, registry, weights, now.getTime());
  const qualification = assessQualification(
    requirements,
    {
      company: input.company,
      capabilities: input.capabilities,
      certificates: input.certificates,
      completeKinds: options.completeCapabilityKinds ?? [],
      category: commercial.primaryCategory,
      estimatedValue: opp.estimatedValue === null ? null : Number(opp.estimatedValue),
      uf: opp.uf,
      today: now.toISOString().slice(0, 10),
      registry,
      dictionary,
    },
    weights,
  );

  // 5. Structured opinion.
  const documentsAnalyzed = input.documents.map(({ document, pages }) => {
    const unread = pages.filter((p) => p.text.trim().length < 20).map((p) => p.page);
    return { documentId: document.id, kind: document.kind, title: document.title, pages: pages.length, pagesWithText: pages.length - unread.length, unreadPages: unread };
  });
  const base = { opportunity: opp, commercial, qualification, findings: extractFindings(safe), alerts, documents: documentsAnalyzed, registry, weights, discardedLlmQuotes: llm.discardedQuotes };
  const risks = buildRisks(base);
  const reasons = buildReasons(base);
  const [c1, c2] = classification.categories;
  const confidence = computeConfidence(base, (c1?.score ?? 0) - (c2?.score ?? 0));
  const versions = { engine: ENGINE_VERSION, dictionary: dictionary.version, weights: weights.version, prompt: llm.used ? FIT_PROMPT_VERSION : null };

  const { daysToClose: _d, excludedBy: _e, ...commercialOut } = commercial;
  return fitAssessmentResult.parse({
    schemaVersion: FIT_RESULT_SCHEMA_VERSION,
    opportunityId: opp.id,
    companyId: input.company.id,
    generatedAt: now.toISOString(),
    inputHash: computeInputHash(input, versions, options.llm?.model ?? null),
    versions,
    commercial: commercialOut,
    qualification,
    confidence,
    favorableReasons: reasons.favorable,
    unfavorableReasons: reasons.unfavorable,
    risks,
    pendingItems: buildPendingItems(base),
    evidence: registry.all(),
    preliminaryRecommendation: recommend(base, risks, confidence),
    documentsAnalyzed,
    securityAlerts: alerts,
    llm,
  });
}

const CONFIDENCE: Record<FitAssessmentResult['confidence']['level'], 'high' | 'medium' | 'low'> = { high: 'high', medium: 'medium', low: 'low' };

/**
 * Builds the canonical AIAnalysis row (history in Postgres, persisted by T-303). `reviewStatus` starts
 * at `pending_review` and only changes through HumanReview (invariant 3).
 */
export function toAIAnalysis(
  result: FitAssessmentResult,
  meta: { id: string; requestedByUserId: string | null; queuedAt: string; startedAt: string; durationMs: number; llm?: JsonModel },
): AIAnalysis {
  const documentIds = result.documentsAnalyzed.map((d) => d.documentId);
  if (!documentIds.length) throw new InvalidFitInput(['AIAnalysis exige ao menos um documento (documentIds.min(1))']);
  return aiAnalysis.parse({
    id: meta.id,
    opportunityId: result.opportunityId,
    companyId: result.companyId,
    documentIds,
    kind: 'fit_assessment',
    status: 'succeeded',
    engine: result.llm.used ? 'llm' : 'local_rules',
    provider: result.llm.used ? (meta.llm?.provider ?? null) : null,
    model: result.llm.used ? (meta.llm?.model ?? null) : null,
    promptVersion: result.versions.prompt ?? `rules:${result.versions.engine}`,
    resultSchemaVersion: FIT_RESULT_SCHEMA_VERSION,
    inputHash: result.inputHash,
    result,
    confidence: CONFIDENCE[result.confidence.level],
    warnings: [...result.llm.warnings, ...result.securityAlerts.map((a) => `instrução embutida em ${a.documentId} p.${a.page}`)],
    tokensIn: result.llm.used ? result.llm.tokensIn : null,
    tokensOut: result.llm.used ? result.llm.tokensOut : null,
    costUsd: null,
    durationMs: meta.durationMs,
    errorCode: null,
    errorMessage: null,
    reviewStatus: 'pending_review',
    requestedByUserId: meta.requestedByUserId,
    queuedAt: meta.queuedAt,
    startedAt: meta.startedAt,
    finishedAt: result.generatedAt.replace('Z', '+00:00'),
  });
}
