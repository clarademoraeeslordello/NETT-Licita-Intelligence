/**
 * Leitura de oportunidades para /api/v1 (T-204). Funções recebem `db` e `now` para serem testáveis
 * com Postgres real. Dados públicos e globais: sem `company_id`; a autenticação é da rota.
 * Paginação por chave (keyset) — estável sob inserções concorrentes e sem OFFSET.
 *
 * Precisão do cursor: a chave de ordenação usa publishedAt/proposalsCloseAt, que entram com
 * milissegundos (ISO da fonte); não há perda ao ir e voltar por `Date`.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { OpportunityListQuery, OpportunityView } from '@/contracts/api';
import type { Db } from '../../db';
import { documents, opportunities, opportunityItems, opportunitySearch, sources } from '../../db/schema';
import { decodeCursor, encodeCursor, InvalidCursor } from './cursor';
import { searchTokens } from './search-index';
import { effectiveStatus, effectiveStatusCondition } from './status';

export const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
const iso = (d: Date | null) => (d ? d.toISOString() : null);
/** Data pura (YYYY-MM-DD) = dia inteiro em America/Sao_Paulo: início (00:00) no limite inferior, fim (23:59:59.999) no superior. */
const dateOrNull = (v: string | undefined, edge: 'start' | 'end') =>
  v ? new Date(v.length === 10 ? `${v}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}-03:00` : v) : null;

/** Escapa curingas do LIKE para busca literal. */
export const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Busca textual indexada (T-215, ADR-024): `opportunity_search.search_text` (minúsculas, sem acento, trigramas GIN).
 * TODAS as palavras da consulta (até 8) precisam aparecer, em qualquer ordem. A consulta passa pela mesma
 * normalização da escrita (search-index.ts).
 */
export const opportunitySearchCondition = (q: string): SQL => {
  const likes = searchTokens(q).map((t) => sql`${opportunitySearch.searchText} like ${`%${escapeLike(t)}%`}`);
  if (!likes.length) return sql`false`;
  return sql`${opportunities.id} in (select ${opportunitySearch.opportunityId} from ${opportunitySearch} where ${sql.join(likes, sql` and `)})`;
};

type Row = typeof opportunities.$inferSelect;

export function toOpportunityView(o: Row, sourceKey: string, now: Date): OpportunityView {
  return {
    id: o.id,
    canonicalKey: o.canonicalKey,
    primarySourceId: o.primarySourceId,
    title: o.title,
    objectDescription: o.objectDescription,
    agencyName: o.agencyName,
    agencyCnpj: o.agencyCnpj,
    agencyUnit: o.agencyUnit,
    municipality: o.municipality,
    uf: o.uf,
    sphere: o.sphere,
    modalityCode: o.modalityCode,
    modalityName: o.modalityName,
    disputeMode: o.disputeMode,
    legalBasis: o.legalBasis,
    processNumber: o.processNumber,
    status: o.status,
    publishedAt: iso(o.publishedAt),
    proposalsOpenAt: iso(o.proposalsOpenAt),
    proposalsCloseAt: iso(o.proposalsCloseAt),
    sessionAt: iso(o.sessionAt),
    estimatedValue: o.estimatedValue,
    awardedValue: o.awardedValue,
    confidentialBudget: o.confidentialBudget,
    priceRegistration: o.priceRegistration,
    meEppBenefit: o.meEppBenefit,
    url: o.url,
    contentHash: o.contentHash,
    firstSeenAt: o.firstSeenAt.toISOString(),
    lastSeenAt: o.lastSeenAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    updatedAt: (o.updatedAt ?? o.createdAt).toISOString(),
    effectiveStatus: effectiveStatus(o, now),
    sourceKey,
  };
}

function filters(q: OpportunityListQuery, now: Date): SQL[] {
  const w: SQL[] = [];
  if (q.q) w.push(opportunitySearchCondition(q.q));
  if (q.ufs) w.push(inArray(opportunities.uf, q.ufs));
  if (q.modalities) w.push(inArray(opportunities.modalityCode, q.modalities));
  if (q.status) w.push(effectiveStatusCondition(q.status, now));
  if (q.sourceKey) w.push(eq(sources.key, q.sourceKey));
  if (q.minValue !== undefined) w.push(sql`${opportunities.estimatedValue} >= ${q.minValue}::numeric`);
  if (q.maxValue !== undefined) w.push(sql`${opportunities.estimatedValue} <= ${q.maxValue}::numeric`);
  const from = dateOrNull(q.closesFrom, 'start');
  const to = dateOrNull(q.closesTo, 'end');
  if (from) w.push(gte(opportunities.proposalsCloseAt, from));
  if (to) w.push(lte(opportunities.proposalsCloseAt, to));
  return w;
}

const sortKey = {
  published_desc: sql<string>`coalesce(${opportunities.publishedAt}, ${EPOCH_ISO}::timestamptz)`,
  close_asc: sql<string>`coalesce(${opportunities.proposalsCloseAt}, 'infinity'::timestamptz)`,
} as const;

export async function listOpportunities(db: Db, q: OpportunityListQuery, now = new Date()) {
  const where = filters(q, now);
  if (q.cursor) {
    const c = decodeCursor(q.cursor, q.sort);
    const k = q.sort === 'published_desc' ? sql`${c.k ?? EPOCH_ISO}::timestamptz` : sql`coalesce(${c.k}::timestamptz, 'infinity'::timestamptz)`;
    where.push(
      q.sort === 'published_desc'
        ? sql`(${sortKey.published_desc}, ${opportunities.id}) < (${k}, ${c.id}::uuid)`
        : sql`(${sortKey.close_asc}, ${opportunities.id}) > (${k}, ${c.id}::uuid)`,
    );
  }
  const order = q.sort === 'published_desc' ? [desc(sortKey.published_desc), desc(opportunities.id)] : [asc(sortKey.close_asc), asc(opportunities.id)];
  const rows = await db
    .select({ o: opportunities, sourceKey: sources.key })
    .from(opportunities)
    .innerJoin(sources, eq(sources.id, opportunities.primarySourceId))
    .where(and(...where))
    .orderBy(...order)
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  const hasMore = rows.length > q.limit;
  const k = last ? (q.sort === 'published_desc' ? iso(last.o.publishedAt) ?? EPOCH_ISO : iso(last.o.proposalsCloseAt)) : null;
  return {
    items: page.map((r) => toOpportunityView(r.o, r.sourceKey, now)),
    nextCursor: hasMore && last ? encodeCursor({ s: q.sort, k, id: last.o.id }) : null,
  };
}

export async function getOpportunity(db: Db, id: string, now = new Date()): Promise<OpportunityView | null> {
  const [r] = await db
    .select({ o: opportunities, sourceKey: sources.key })
    .from(opportunities)
    .innerJoin(sources, eq(sources.id, opportunities.primarySourceId))
    .where(eq(opportunities.id, id))
    .limit(1);
  return r ? toOpportunityView(r.o, r.sourceKey, now) : null;
}

export async function opportunityExists(db: Db, id: string): Promise<boolean> {
  const [r] = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.id, id)).limit(1);
  return Boolean(r);
}

/** Itens da oportunidade, paginados pelo número do item (cursor = último número). */
export async function listItems(db: Db, opportunityId: string, limit: number, cursor?: string) {
  const after = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isInteger(after) || after < 0) throw new InvalidCursor();
  const rows = await db
    .select()
    .from(opportunityItems)
    .where(and(eq(opportunityItems.opportunityId, opportunityId), sql`${opportunityItems.number} > ${after}`))
    .orderBy(asc(opportunityItems.number))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((i) => ({ ...i, awardedAt: iso(i.awardedAt) })),
    nextCursor: rows.length > limit ? String(page.at(-1)!.number) : null,
  };
}

/** Documentos PÚBLICOS (companyId nulo). Documentos privados nunca saem por aqui. */
export async function listPublicDocuments(db: Db, opportunityId: string) {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.opportunityId, opportunityId), sql`${documents.companyId} is null`))
    .orderBy(asc(documents.createdAt), asc(documents.id));
  return {
    items: rows.map((d) => ({
      id: d.id,
      opportunityId: d.opportunityId!,
      kind: d.kind,
      title: d.title,
      sourceUrl: d.sourceUrl,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      sha256: d.sha256,
      pageCount: d.pageCount,
      textStatus: d.textStatus,
      stored: d.storageKey !== null,
      fetchedAt: iso(d.fetchedAt),
    })),
    nextCursor: null,
  };
}
