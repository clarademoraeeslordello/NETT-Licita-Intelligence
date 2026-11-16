/**
 * DTOs de /api/v1/opportunities*, /sources e /prices (T-204, agente 02).
 * Entidades canônicas vêm de `src/contracts`; aqui só a forma de resposta e os parâmetros de consulta.
 * Dinheiro: string decimal. Datas: ISO 8601 com offset.
 */
import { z } from 'zod';
import { decimal, isoDateTime, pageOf, sha256, uf, uuid } from '../common';
import { document, textStatus } from '../documents';
import { opportunity, opportunityItem, opportunityStatus, syncStatus, sourceKind } from '../sources';

/* ------------------------------ parâmetros ------------------------------- */

/** Lista separada por vírgula → array validado por `item`. Vazio/ausente → undefined. */
const csv = <T extends z.ZodType>(item: T, max = 30) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' ? v.slice(0, 500).split(',').map((x) => x.trim()).filter(Boolean) : v),
      z.array(item).min(1).max(max),
    )
    .optional();

const limit = (def: number, max: number) => z.coerce.number().int().min(1).max(max).default(def);
const when = z.union([isoDateTime, z.iso.date()]);

export const opportunitySort = z.enum(['published_desc', 'close_asc']);

export const opportunityListQuery = z.object({
  /** Busca textual no título, objeto e órgão. */
  q: z.string().trim().min(2).max(100).optional(),
  ufs: csv(uf, 27),
  modalities: csv(z.coerce.number().int().positive()),
  /** Situação EFETIVA (ADR-018). */
  status: csv(opportunityStatus, 7),
  sourceKey: z.string().regex(/^[a-z0-9_]{2,40}$/).optional(),
  /** Valor estimado; oportunidades sem valor (ou sigilosas) ficam fora quando há limite. */
  minValue: decimal.optional(),
  maxValue: decimal.optional(),
  /** Janela do encerramento das propostas. */
  closesFrom: when.optional(),
  closesTo: when.optional(),
  sort: opportunitySort.default('published_desc'),
  limit: limit(30, 100),
  cursor: z.string().max(400).optional(),
});
export type OpportunityListQuery = z.infer<typeof opportunityListQuery>;

export const pageQuery = (def: number, max: number) => z.object({ limit: limit(def, max), cursor: z.string().max(400).optional() });

/* -------------------------------- respostas ------------------------------ */

/** Oportunidade + situação efetiva calculada na leitura (ADR-018) + chave da fonte primária. */
export const opportunityView = opportunity.extend({
  effectiveStatus: opportunityStatus,
  sourceKey: z.string(),
});
export type OpportunityView = z.infer<typeof opportunityView>;
export const opportunityPage = pageOf(opportunityView);

export const opportunityItemPage = pageOf(opportunityItem);

/** Documento público de uma oportunidade. Nunca expõe chave de storage; o download é por URL assinada (T-203). */
export const publicDocumentView = z.object({
  id: uuid,
  opportunityId: uuid,
  kind: document.shape.kind,
  title: z.string(),
  sourceUrl: z.url().nullable(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sha256: sha256.nullable(),
  pageCount: z.number().int().positive().nullable(),
  textStatus,
  /** Já baixado para o storage? */
  stored: z.boolean(),
  fetchedAt: isoDateTime.nullable(),
});
export type PublicDocumentView = z.infer<typeof publicDocumentView>;
export const publicDocumentPage = pageOf(publicDocumentView);

export const sourceView = z.object({
  key: z.string(),
  name: z.string(),
  kind: sourceKind,
  enabled: z.boolean(),
  lastSyncAt: isoDateTime.nullable(),
  lastSyncStatus: syncStatus.nullable(),
});
export type SourceView = z.infer<typeof sourceView>;
export const sourcePage = pageOf(sourceView);

export const syncRequest = z.object({
  mode: z.enum(['incremental', 'backfill']).default('incremental'),
  since: isoDateTime.optional(),
});
export const syncAccepted = z.object({ jobId: z.string(), sourceKey: z.string(), mode: z.enum(['incremental', 'backfill']) });

/* --------------------------------- preços -------------------------------- */

export const priceQuery = z.object({
  /** Descrição do item. Mínimo de 3 caracteres para não varrer a base inteira. */
  q: z.string().trim().min(3).max(100),
  ufs: csv(uf, 27),
  limit: limit(30, 100),
  cursor: z.string().max(400).optional(),
});
export type PriceQuery = z.infer<typeof priceQuery>;

/** Preço homologado de um item (OpportunityItem com resultado). */
export const priceSample = z.object({
  itemId: uuid,
  opportunityId: uuid,
  description: z.string(),
  unit: z.string(),
  quantity: decimal,
  estimatedUnitValue: decimal.nullable(),
  awardedUnitValue: decimal,
  /** (estimado − homologado) / estimado × 100, 2 casas; positivo = abaixo do estimado. */
  discountPercent: z.string().nullable(),
  supplierCnpj: z.string().nullable(),
  supplierName: z.string().nullable(),
  awardedAt: isoDateTime.nullable(),
  agencyName: z.string(),
  municipality: z.string().nullable(),
  uf: uf.nullable(),
  modalityName: z.string().nullable(),
  url: z.url(),
});
export type PriceSample = z.infer<typeof priceSample>;

/** Estatística sobre TODAS as amostras da busca (não só a página). */
export const priceSummary = z.object({
  count: z.number().int().nonnegative(),
  min: decimal.nullable(),
  median: decimal.nullable(),
  max: decimal.nullable(),
});
export const pricePage = pageOf(priceSample).extend({ summary: priceSummary });
export type PricePage = z.infer<typeof pricePage>;
