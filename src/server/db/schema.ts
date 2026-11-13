/**
 * Schema Drizzle das entidades canônicas (T-101). Dono: agente 01.
 *
 * Regras:
 *  - Nome de coluna TS = nome de campo do contrato (`src/contracts`). Verificado em `schema.test.ts`.
 *  - Enums do Postgres são gerados a partir dos enums Zod do contrato: fonte única.
 *  - Dinheiro = numeric(18,4) (string). Instantes = timestamptz. Datas puras = date (string).
 *  - Integridade de tenant por FK composta (id, company_id) onde há referência entre dados privados.
 *  - Mudança aqui exige `npm run db:generate` e nova migration; nunca editar migration mesclada.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import * as c from '../../contracts';

/* -------------------------------- helpers -------------------------------- */

const fromZod = <V extends string>(name: string, values: readonly V[]) => pgEnum(name, values as unknown as [V, ...V[]]);

const id = () => uuid('id').primaryKey().defaultRandom();
const tz = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* --------------------------------- enums --------------------------------- */

export const ufEnum = fromZod('uf', c.uf.options);
export const companySizeEnum = fromZod('company_size', c.companySize.options);
export const companyStatusEnum = fromZod('company_status', c.company.shape.status.options);
export const companyRoleEnum = fromZod('company_role', c.companyRole.options);
export const sourceKindEnum = fromZod('source_kind', c.sourceKind.options);
export const syncStatusEnum = fromZod('sync_status', c.syncStatus.options);
export const normalizationStatusEnum = fromZod('normalization_status', c.normalizationStatus.options);
export const opportunityStatusEnum = fromZod('opportunity_status', c.opportunityStatus.options);
export const govSphereEnum = fromZod('gov_sphere', c.govSphere.options);
export const meEppBenefitEnum = fromZod('me_epp_benefit', c.meEppBenefit.options);
export const itemKindEnum = fromZod('item_kind', c.opportunityItem.shape.kind.options);
export const documentKindEnum = fromZod('document_kind', c.documentKind.options);
export const documentOriginEnum = fromZod('document_origin', c.documentOrigin.options);
export const textStatusEnum = fromZod('text_status', c.textStatus.options);
export const analysisKindEnum = fromZod('analysis_kind', c.analysisKind.options);
export const analysisStatusEnum = fromZod('analysis_status', c.analysisStatus.options);
export const analysisEngineEnum = fromZod('analysis_engine', c.analysisEngine.options);
export const confidenceEnum = fromZod('confidence', ['high', 'medium', 'low']);
export const reviewStatusEnum = fromZod('review_status', c.reviewStatus.options);
export const reviewSubjectEnum = fromZod('review_subject', c.reviewSubject.options);
export const reviewDecisionEnum = fromZod('review_decision', c.reviewDecision.options);
export const capabilityKindEnum = fromZod('capability_kind', c.capabilityKind.options);
export const alertChannelEnum = fromZod('alert_channel', c.searchProfile.shape.alertChannel.options);
export const pipelineStageEnum = fromZod('pipeline_stage', c.pipelineStage.options);
export const trackingOutcomeEnum = fromZod('tracking_outcome', ['won', 'lost', 'withdrawn']);
export const metricGranularityEnum = fromZod('metric_granularity', c.metricGranularity.options);

/* ------------------------------- tenancy --------------------------------- */

export const companies = pgTable('companies', {
  id: id(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  cnpj: text('cnpj').notNull().unique(),
  size: companySizeEnum('size').notNull(),
  status: companyStatusEnum('status').notNull().default('active'),
  ...timestamps,
}, (t) => [check('companies_cnpj_digits', sql`${t.cnpj} ~ '^[0-9]{14}$'`)]);

export const userAccounts = pgTable('user_accounts', {
  id: id(),
  keycloakSub: text('keycloak_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export const memberships = pgTable('memberships', {
  userId: uuid('user_id').notNull().references(() => userAccounts.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  role: companyRoleEnum('role').notNull(),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.userId, t.companyId] }), index('memberships_company_idx').on(t.companyId)]);

/* ------------------------- fontes e oportunidades ------------------------ */

export const sources = pgTable('sources', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  kind: sourceKindEnum('kind').notNull(),
  baseUrl: text('base_url'),
  enabled: boolean('enabled').notNull().default(true),
  rateLimit: jsonb('rate_limit').$type<c.Source['rateLimit']>().notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  lastSyncAt: tz('last_sync_at'),
  lastSyncStatus: syncStatusEnum('last_sync_status'),
  lastCursor: jsonb('last_cursor'),
  ...timestamps,
}, (t) => [check('sources_key_format', sql`${t.key} ~ '^[a-z0-9_]{2,40}$'`)]);

export const opportunities = pgTable('opportunities', {
  id: id(),
  canonicalKey: text('canonical_key').notNull().unique(),
  primarySourceId: uuid('primary_source_id').notNull().references(() => sources.id),
  title: text('title').notNull(),
  objectDescription: text('object_description').notNull(),
  agencyName: text('agency_name').notNull(),
  agencyCnpj: text('agency_cnpj'),
  agencyUnit: text('agency_unit'),
  municipality: text('municipality'),
  uf: ufEnum('uf'),
  sphere: govSphereEnum('sphere').notNull(),
  modalityCode: integer('modality_code'),
  modalityName: text('modality_name'),
  disputeMode: text('dispute_mode'),
  legalBasis: text('legal_basis'),
  processNumber: text('process_number'),
  status: opportunityStatusEnum('status').notNull(),
  publishedAt: tz('published_at'),
  proposalsOpenAt: tz('proposals_open_at'),
  proposalsCloseAt: tz('proposals_close_at'),
  sessionAt: tz('session_at'),
  estimatedValue: money('estimated_value'),
  awardedValue: money('awarded_value'),
  confidentialBudget: boolean('confidential_budget').notNull().default(false),
  priceRegistration: boolean('price_registration').notNull().default(false),
  meEppBenefit: meEppBenefitEnum('me_epp_benefit').notNull().default('unknown'),
  url: text('url').notNull(),
  contentHash: text('content_hash').notNull(),
  firstSeenAt: tz('first_seen_at').notNull().defaultNow(),
  lastSeenAt: tz('last_seen_at').notNull().defaultNow(),
  ...timestamps,
}, (t) => [
  check('opportunities_canonical_key_format', sql`${t.canonicalKey} ~ '^[a-z0-9_]+:.+$'`),
  index('opportunities_status_close_idx').on(t.status, t.proposalsCloseAt),
  index('opportunities_uf_idx').on(t.uf),
]);

export const sourceRecords = pgTable('source_records', {
  id: id(),
  sourceId: uuid('source_id').notNull().references(() => sources.id),
  externalId: text('external_id').notNull(),
  payload: jsonb('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  fetchedAt: tz('fetched_at').notNull().defaultNow(),
  normalizationStatus: normalizationStatusEnum('normalization_status').notNull().default('pending'),
  normalizationError: text('normalization_error'),
  normalizedAt: tz('normalized_at'),
  opportunityId: uuid('opportunity_id').references(() => opportunities.id),
}, (t) => [
  unique('source_records_version_uq').on(t.sourceId, t.externalId, t.payloadHash),
  index('source_records_pending_idx').on(t.normalizationStatus),
  index('source_records_opportunity_idx').on(t.opportunityId),
]);

export const opportunityItems = pgTable('opportunity_items', {
  id: id(),
  opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  description: text('description').notNull(),
  kind: itemKindEnum('kind').notNull(),
  quantity: money('quantity').notNull(),
  unit: text('unit').notNull(),
  estimatedUnitValue: money('estimated_unit_value'),
  estimatedTotalValue: money('estimated_total_value'),
  judgingCriterion: text('judging_criterion'),
  meEppBenefit: meEppBenefitEnum('me_epp_benefit').notNull().default('unknown'),
  catalogCode: text('catalog_code'),
  awardedUnitValue: money('awarded_unit_value'),
  awardedSupplierCnpj: text('awarded_supplier_cnpj'),
  awardedSupplierName: text('awarded_supplier_name'),
  awardedAt: tz('awarded_at'),
}, (t) => [unique('opportunity_items_number_uq').on(t.opportunityId, t.number), check('opportunity_items_number_positive', sql`${t.number} > 0`)]);

/* ------------------------------- documentos ------------------------------ */

export const documents = pgTable('documents', {
  id: id(),
  companyId: uuid('company_id').references(() => companies.id),
  opportunityId: uuid('opportunity_id').references(() => opportunities.id),
  kind: documentKindEnum('kind').notNull(),
  origin: documentOriginEnum('origin').notNull(),
  title: text('title').notNull(),
  sourceUrl: text('source_url'),
  storageKey: text('storage_key').unique(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes'),
  sha256: text('sha256'),
  pageCount: integer('page_count'),
  textStatus: textStatusEnum('text_status').notNull().default('pending'),
  textStorageKey: text('text_storage_key'),
  uploadedByUserId: uuid('uploaded_by_user_id').references(() => userAccounts.id),
  certificate: jsonb('certificate').$type<NonNullable<c.Document['certificate']>>(),
  fetchedAt: tz('fetched_at'),
  ...timestamps,
}, (t) => [
  unique('documents_id_company_uq').on(t.id, t.companyId),
  check('documents_scope', sql`${t.companyId} is not null or ${t.opportunityId} is not null`),
  check('documents_certificate', sql`${t.kind} <> 'company_certificate' or (${t.companyId} is not null and ${t.certificate} is not null)`),
  check('documents_private_key', sql`${t.companyId} is null or ${t.storageKey} is null or ${t.storageKey} like 'companies/' || ${t.companyId}::text || '/%'`),
  check('documents_public_key', sql`${t.companyId} is not null or ${t.storageKey} is null or ${t.storageKey} like 'public/%'`),
  index('documents_opportunity_idx').on(t.opportunityId),
  index('documents_company_idx').on(t.companyId),
]);

/* ------------------------- perfil e capacidades -------------------------- */

export const companyCapabilities = pgTable('company_capabilities', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  kind: capabilityKindEnum('kind').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
  catalogCodes: text('catalog_codes').array().notNull().default(sql`'{}'::text[]`),
  ufs: ufEnum('ufs').array().notNull().default(sql`'{}'::uf[]`),
  maxContractValue: money('max_contract_value'),
  evidenceDocumentId: uuid('evidence_document_id'),
  validUntil: date('valid_until'),
  active: boolean('active').notNull().default(true),
  ...timestamps,
}, (t) => [
  foreignKey({ name: 'company_capabilities_evidence_fk', columns: [t.evidenceDocumentId, t.companyId], foreignColumns: [documents.id, documents.companyId] }),
  index('company_capabilities_company_idx').on(t.companyId),
]);

export const searchProfiles = pgTable('search_profiles', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  includeTerms: text('include_terms').array().notNull(),
  excludeTerms: text('exclude_terms').array().notNull().default(sql`'{}'::text[]`),
  ufs: ufEnum('ufs').array().notNull().default(sql`'{}'::uf[]`),
  modalityCodes: integer('modality_codes').array().notNull().default(sql`'{}'::integer[]`),
  minValue: money('min_value'),
  maxValue: money('max_value'),
  sourceKeys: text('source_keys').array().notNull().default(sql`'{}'::text[]`),
  minScore: integer('min_score').notNull().default(50),
  alertChannel: alertChannelEnum('alert_channel').notNull().default('none'),
  ownerUserId: uuid('owner_user_id').notNull().references(() => userAccounts.id),
  active: boolean('active').notNull().default(true),
  ...timestamps,
}, (t) => [
  unique('search_profiles_id_company_uq').on(t.id, t.companyId),
  check('search_profiles_terms', sql`cardinality(${t.includeTerms}) >= 1`),
  check('search_profiles_score', sql`${t.minScore} between 0 and 100`),
  check('search_profiles_value_range', sql`${t.minValue} is null or ${t.maxValue} is null or ${t.minValue} <= ${t.maxValue}`),
  index('search_profiles_company_idx').on(t.companyId),
]);

/* ---------------------------- IA e revisão ------------------------------- */

export const aiAnalyses = pgTable('ai_analyses', {
  id: id(),
  opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
  companyId: uuid('company_id').references(() => companies.id),
  documentIds: uuid('document_ids').array().notNull(),
  kind: analysisKindEnum('kind').notNull(),
  status: analysisStatusEnum('status').notNull().default('queued'),
  engine: analysisEngineEnum('engine'),
  provider: text('provider'),
  model: text('model'),
  promptVersion: text('prompt_version').notNull(),
  resultSchemaVersion: text('result_schema_version').notNull(),
  inputHash: text('input_hash').notNull(),
  result: jsonb('result'),
  confidence: confidenceEnum('confidence'),
  warnings: text('warnings').array().notNull().default(sql`'{}'::text[]`),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  costUsd: money('cost_usd'),
  durationMs: integer('duration_ms'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  reviewStatus: reviewStatusEnum('review_status').notNull().default('pending_review'),
  requestedByUserId: uuid('requested_by_user_id').references(() => userAccounts.id),
  queuedAt: tz('queued_at').notNull().defaultNow(),
  startedAt: tz('started_at'),
  finishedAt: tz('finished_at'),
}, (t) => [
  check('ai_analyses_documents', sql`cardinality(${t.documentIds}) >= 1`),
  check('ai_analyses_result_on_success', sql`${t.status} <> 'succeeded' or ${t.result} is not null`),
  index('ai_analyses_input_hash_idx').on(t.inputHash),
  index('ai_analyses_opportunity_idx').on(t.opportunityId),
  index('ai_analyses_company_idx').on(t.companyId),
]);

export const matchScores = pgTable('match_scores', {
  id: id(),
  opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  searchProfileId: uuid('search_profile_id').notNull(),
  score: integer('score').notNull(),
  factors: jsonb('factors').$type<c.MatchScore['factors']>().notNull(),
  caps: text('caps').array().notNull().default(sql`'{}'::text[]`),
  algorithmVersion: text('algorithm_version').notNull(),
  opportunityContentHash: text('opportunity_content_hash').notNull(),
  computedAt: tz('computed_at').notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: 'match_scores_profile_fk', columns: [t.searchProfileId, t.companyId], foreignColumns: [searchProfiles.id, searchProfiles.companyId] }).onDelete('cascade'),
  unique('match_scores_profile_opportunity_uq').on(t.searchProfileId, t.opportunityId),
  check('match_scores_range', sql`${t.score} between 0 and 100`),
  index('match_scores_company_score_idx').on(t.companyId, t.score),
]);

/** Append-only: UPDATE/DELETE bloqueados por trigger (migration 0001). */
export const humanReviews = pgTable('human_reviews', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  subjectType: reviewSubjectEnum('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  reviewerUserId: uuid('reviewer_user_id').notNull().references(() => userAccounts.id),
  decision: reviewDecisionEnum('decision').notNull(),
  corrections: jsonb('corrections').$type<c.HumanReview['corrections']>().notNull().default([]),
  comment: text('comment'),
  createdAt: tz('created_at').notNull().defaultNow(),
}, (t) => [
  unique('human_reviews_id_company_uq').on(t.id, t.companyId),
  check('human_reviews_rejected_comment', sql`${t.decision} <> 'rejected' or length(trim(coalesce(${t.comment}, ''))) > 0`),
  check('human_reviews_changes_corrections', sql`${t.decision} <> 'approved_with_changes' or jsonb_array_length(${t.corrections}) > 0`),
  index('human_reviews_subject_idx').on(t.subjectType, t.subjectId),
]);

/* --------------------------- pipeline e métricas ------------------------- */

export const opportunityTrackings = pgTable('opportunity_trackings', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
  stage: pipelineStageEnum('stage').notNull().default('triage'),
  assignedConsultantId: uuid('assigned_consultant_id').references(() => userAccounts.id),
  proposalValue: money('proposal_value'),
  outcome: trackingOutcomeEnum('outcome'),
  bidDecisionReviewId: uuid('bid_decision_review_id'),
  notes: text('notes').notNull().default(''),
  discardedAt: tz('discarded_at'),
  ...timestamps,
}, (t) => [
  unique('opportunity_trackings_company_opportunity_uq').on(t.companyId, t.opportunityId),
  foreignKey({ name: 'opportunity_trackings_bid_review_fk', columns: [t.bidDecisionReviewId, t.companyId], foreignColumns: [humanReviews.id, humanReviews.companyId] }),
  check('opportunity_trackings_bid_decision', sql`${t.stage} in ('triage', 'analysis', 'documentation') or ${t.bidDecisionReviewId} is not null`),
]);

export const consultantMetrics = pgTable('consultant_metrics', {
  id: id(),
  consultantUserId: uuid('consultant_user_id').notNull().references(() => userAccounts.id),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  granularity: metricGranularityEnum('granularity').notNull(),
  periodStart: date('period_start').notNull(),
  opportunitiesTriaged: integer('opportunities_triaged').notNull().default(0),
  analysesRequested: integer('analyses_requested').notNull().default(0),
  analysesReviewed: integer('analyses_reviewed').notNull().default(0),
  medianReviewLatencyHours: money('median_review_latency_hours'),
  bidsSubmitted: integer('bids_submitted').notNull().default(0),
  bidsWon: integer('bids_won').notNull().default(0),
  bidsLost: integer('bids_lost').notNull().default(0),
  valueSubmitted: money('value_submitted').notNull().default('0'),
  valueWon: money('value_won').notNull().default('0'),
  winRate: money('win_rate'),
  computedAt: tz('computed_at').notNull().defaultNow(),
}, (t) => [
  unique('consultant_metrics_period_uq').on(t.consultantUserId, t.companyId, t.granularity, t.periodStart).nullsNotDistinct(),
]);

/* ------------------------------- sessões --------------------------------- */

/**
 * Sessão de aplicação (T-103). Suporte, não é entidade canônica.
 * O cookie carrega um token aleatório; o banco guarda só o SHA-256 (vazamento do banco não reabre sessões).
 * Papéis globais do Keycloak são fotografados no login; a sessão expira em no máximo 8 h.
 */
export const sessions = pgTable('sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => userAccounts.id, { onDelete: 'cascade' }),
  realmRoles: text('realm_roles').array().notNull().default(sql`'{}'::text[]`),
  createdAt: tz('created_at').notNull().defaultNow(),
  lastSeenAt: tz('last_seen_at').notNull().defaultNow(),
  expiresAt: tz('expires_at').notNull(),
  revokedAt: tz('revoked_at'),
}, (t) => [index('sessions_user_idx').on(t.userId), check('sessions_token_hash', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`)]);
