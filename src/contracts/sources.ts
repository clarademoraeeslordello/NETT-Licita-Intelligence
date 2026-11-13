/**
 * Source, SourceRecord, Opportunity e OpportunityItem — dados PÚBLICOS, globais (sem company_id).
 * Escrita: somente código do agente 02 (src/server/sources). Leitura: todos.
 */
import { z } from 'zod';
import { decimal, isoDateTime, sha256, timestamps, uf, uuid } from './common';

/* --------------------------------- Source -------------------------------- */

export const sourceKind = z.enum(['api', 'scraper', 'manual_upload', 'email']);
export const syncStatus = z.enum(['ok', 'partial', 'error']);

export const source = z.object({
  id: uuid,
  /** Slug estável, ex.: "pncp". Único. Usado em payloads de fila e em `canonicalKey`. */
  key: z.string().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string(),
  kind: sourceKind,
  baseUrl: z.url().nullable(),
  enabled: z.boolean(),
  rateLimit: z.object({
    requestsPerMinute: z.number().int().positive(),
    maxConcurrency: z.number().int().positive(),
  }),
  /** Configuração não secreta. Segredos: apenas o NOME da variável de ambiente. */
  config: z.record(z.string(), z.unknown()),
  lastSyncAt: isoDateTime.nullable(),
  lastSyncStatus: syncStatus.nullable(),
  /** Cursor opaco do conector para sincronização incremental. */
  lastCursor: z.unknown().nullable(),
  ...timestamps,
});
export type Source = z.infer<typeof source>;

/* ------------------------------ SourceRecord ----------------------------- */

export const normalizationStatus = z.enum(['pending', 'normalized', 'skipped', 'error']);

/**
 * Captura bruta e IMUTÁVEL de um registro da fonte. Nova versão do mesmo registro = nova linha
 * (único por sourceId + externalId + payloadHash). Permite reprocessar a normalização.
 */
export const sourceRecord = z.object({
  id: uuid,
  sourceId: uuid,
  externalId: z.string().min(1),
  payload: z.unknown(),
  payloadHash: sha256,
  fetchedAt: isoDateTime,
  normalizationStatus: normalizationStatus,
  normalizationError: z.string().nullable(),
  normalizedAt: isoDateTime.nullable(),
  opportunityId: uuid.nullable(),
});
export type SourceRecord = z.infer<typeof sourceRecord>;

/* ------------------------------ Opportunity ------------------------------ */

export const opportunityStatus = z.enum([
  'published',
  'receiving_proposals',
  'closed',
  'awarded',
  'cancelled',
  'suspended',
  'unknown',
]);
export const govSphere = z.enum(['federal', 'estadual', 'municipal', 'distrital', 'desconhecida']);
export const meEppBenefit = z.enum(['none', 'partial', 'total', 'unknown']);

export const opportunity = z.object({
  id: uuid,
  /**
   * Chave de deduplicação entre fontes. Formato: "<sourceKey>:<id natural>".
   * PNCP: "pncp:<cnpj>-<ano>-<sequencial>" (mesmo id do LicitaFlow, prefixado).
   */
  canonicalKey: z.string().regex(/^[a-z0-9_]+:.+$/),
  primarySourceId: uuid,
  title: z.string(),
  objectDescription: z.string(),
  agencyName: z.string(),
  agencyCnpj: z.string().regex(/^\d{14}$/).nullable(),
  agencyUnit: z.string().nullable(),
  municipality: z.string().nullable(),
  uf: uf.nullable(),
  sphere: govSphere,
  modalityCode: z.number().int().nullable(),
  modalityName: z.string().nullable(),
  disputeMode: z.string().nullable(),
  legalBasis: z.string().nullable(),
  processNumber: z.string().nullable(),
  status: opportunityStatus,
  publishedAt: isoDateTime.nullable(),
  proposalsOpenAt: isoDateTime.nullable(),
  proposalsCloseAt: isoDateTime.nullable(),
  sessionAt: isoDateTime.nullable(),
  /** null = não informado ou sigiloso (ver confidentialBudget). */
  estimatedValue: decimal.nullable(),
  awardedValue: decimal.nullable(),
  confidentialBudget: z.boolean(),
  priceRegistration: z.boolean(),
  meEppBenefit,
  url: z.url(),
  /** Hash do conteúdo normalizado; muda => reprocessar aderência. */
  contentHash: sha256,
  firstSeenAt: isoDateTime,
  lastSeenAt: isoDateTime,
  ...timestamps,
});
export type Opportunity = z.infer<typeof opportunity>;

export const opportunityItem = z.object({
  id: uuid,
  opportunityId: uuid,
  number: z.number().int().positive(),
  description: z.string(),
  kind: z.enum(['material', 'service']),
  quantity: decimal,
  unit: z.string(),
  estimatedUnitValue: decimal.nullable(),
  estimatedTotalValue: decimal.nullable(),
  judgingCriterion: z.string().nullable(),
  meEppBenefit,
  catalogCode: z.string().nullable(),
  /** Resultado homologado, quando houver (alimenta inteligência de preços). */
  awardedUnitValue: decimal.nullable(),
  awardedSupplierCnpj: z.string().nullable(),
  awardedSupplierName: z.string().nullable(),
  awardedAt: isoDateTime.nullable(),
});
export type OpportunityItem = z.infer<typeof opportunityItem>;
