/**
 * `source.normalize` (T-202): aplica um SourceRecord à Opportunity canônica.
 *
 * Tudo em UMA transação (inclusive os jobs seguintes, via pg-boss na mesma conexão):
 *  - Opportunity única por `canonicalKey` (invariante 1): insere ou atualiza; `firstSeenAt` e
 *    `primarySourceId` preservados; `lastSeenAt` renovado.
 *  - Itens e documentos só são tocados quando o payload os traz (registro enriquecido).
 *    Itens: upsert por número; o vencedor (`awarded*`, T-214) só é escrito quando o payload traz `resultados`
 *    (consultados), nunca por uma listagem sem eles; itens ausentes na fonte são removidos.
 *    Documentos públicos: deduplicados por (opportunityId, sourceUrl); novos → `document.fetch`.
 *  - `contentHash` mudou (ou oportunidade nova) → `match.score`.
 *  - Registro mais antigo que um já normalizado do mesmo externalId → `normalized` sem aplicar (fora de ordem).
 *  - SourceRecord nunca tem o payload alterado (invariante 2): só status/erro/opportunityId.
 */
import { and, eq, gt, isNull, notInArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import * as s from '../db/schema';
import { enqueueWith } from '../jobs/enqueue';
import { log } from '../jobs/registry';
import type { SyncableConnector } from './connector';
import { contentHashOf } from './pncp/normalize';
import { buildSearchText, upsertSearchText } from './read/search-index';

const data = (v: string | null) => (v === null ? null : new Date(v));

export type NormalizeDeps = { pool: Pool; boss: PgBoss; connectors: ReadonlyMap<string, SyncableConnector> };
export type NormalizeOutcome =
  | { status: 'normalized'; opportunityId: string; created: boolean; contentChanged: boolean; newDocuments: number; items: number | null }
  | { status: 'skipped'; reason: string }
  | { status: 'superseded' | 'already_done' | 'missing' };

export async function normalizeSourceRecord(deps: NormalizeDeps, sourceRecordId: string): Promise<NormalizeOutcome> {
  const client = await deps.pool.connect();
  try {
    await client.query('begin');
    const db = drizzle(client, { schema: s, casing: 'snake_case' });
    const [rec] = await db
      .select({ r: s.sourceRecords, sourceKey: s.sources.key })
      .from(s.sourceRecords)
      .innerJoin(s.sources, eq(s.sources.id, s.sourceRecords.sourceId))
      .where(eq(s.sourceRecords.id, sourceRecordId))
      .for('update', { of: s.sourceRecords });
    if (!rec) {
      await client.query('rollback');
      return { status: 'missing' };
    }
    const r = rec.r;
    if (r.normalizationStatus === 'normalized' || r.normalizationStatus === 'skipped') {
      await client.query('rollback');
      return { status: 'already_done' };
    }
    const connector = deps.connectors.get(rec.sourceKey);
    if (!connector) throw new Error(`conector desconhecido: ${rec.sourceKey}`);

    const marcar = (patch: Partial<typeof s.sourceRecords.$inferInsert>) =>
      db.update(s.sourceRecords).set({ normalizedAt: sql`now()`, ...patch }).where(eq(s.sourceRecords.id, r.id));

    // Fora de ordem: já existe versão mais nova deste registro normalizada.
    const [maisNovo] = await db
      .select({ id: s.sourceRecords.id, opportunityId: s.sourceRecords.opportunityId })
      .from(s.sourceRecords)
      .where(and(eq(s.sourceRecords.sourceId, r.sourceId), eq(s.sourceRecords.externalId, r.externalId), eq(s.sourceRecords.normalizationStatus, 'normalized'), gt(s.sourceRecords.fetchedAt, r.fetchedAt)))
      .limit(1);
    if (maisNovo) {
      await marcar({ normalizationStatus: 'normalized', normalizationError: 'superseded', opportunityId: maisNovo.opportunityId });
      await client.query('commit');
      return { status: 'superseded' };
    }

    const result = connector.normalize(r.payload);
    if ('skip' in result) {
      await marcar({ normalizationStatus: 'skipped', normalizationError: result.skip.slice(0, 500) });
      await client.query('commit');
      return { status: 'skipped', reason: result.skip };
    }

    const o = {
      ...result.opportunity,
      publishedAt: data(result.opportunity.publishedAt),
      proposalsOpenAt: data(result.opportunity.proposalsOpenAt),
      proposalsCloseAt: data(result.opportunity.proposalsCloseAt),
      sessionAt: data(result.opportunity.sessionAt),
    };
    const [anterior] = await db
      .select({ id: s.opportunities.id, contentHash: s.opportunities.contentHash, meEppBenefit: s.opportunities.meEppBenefit })
      .from(s.opportunities)
      .where(eq(s.opportunities.canonicalKey, o.canonicalKey))
      .for('update');
    // Registro só com a listagem (sem itens): o benefício ME/EPP é derivado dos itens e não pode voltar a
    // 'unknown' por falta deles. Preserva o já calculado e re-deriva o hash de forma determinística.
    const payloadTemItens = Array.isArray((r.payload as { itens?: unknown } | null)?.itens);
    if (!payloadTemItens && anterior && o.meEppBenefit === 'unknown' && anterior.meEppBenefit !== 'unknown') {
      o.meEppBenefit = anterior.meEppBenefit;
      o.contentHash = contentHashOf({ listing: o.contentHash, meEppBenefit: o.meEppBenefit });
    }
    const valores = { ...o, primarySourceId: r.sourceId };
    const [salva] = await db
      .insert(s.opportunities)
      .values(valores)
      .onConflictDoUpdate({
        target: s.opportunities.canonicalKey,
        set: { ...o, lastSeenAt: sql`now()`, updatedAt: sql`now()` },
      })
      .returning({ id: s.opportunities.id });
    const opportunityId = salva!.id;
    // Índice de busca (T-215, ADR-024): mesma transação da oportunidade; só regrava se o texto mudou.
    await upsertSearchText(db, opportunityId, buildSearchText(o));
    const created = !anterior;
    const contentChanged = created || anterior!.contentHash !== o.contentHash;

    const p = r.payload as { itens?: unknown; arquivos?: unknown; resultados?: unknown } | null;
    // T-214: só um registro que CONSULTOU os resultados (`resultados` presente) pode escrever/limpar o vencedor do item;
    // listagem sem resultados nunca apaga o que um registro anterior já gravou.
    const consultouResultados = p?.resultados != null && typeof p.resultados === 'object';
    let items: number | null = null;
    if (Array.isArray(p?.itens)) {
      items = result.items.length;
      for (const item of result.items) {
        const i = { ...item, awardedAt: data(item.awardedAt) };
        const { awardedUnitValue, awardedSupplierCnpj, awardedSupplierName, awardedAt, ...estimativa } = i;
        const set = consultouResultados ? { ...estimativa, awardedUnitValue, awardedSupplierCnpj, awardedSupplierName, awardedAt } : estimativa;
        await db
          .insert(s.opportunityItems)
          .values({ ...i, opportunityId })
          .onConflictDoUpdate({ target: [s.opportunityItems.opportunityId, s.opportunityItems.number], set });
      }
      const numeros = result.items.map((i) => i.number);
      await db
        .delete(s.opportunityItems)
        .where(numeros.length ? and(eq(s.opportunityItems.opportunityId, opportunityId), notInArray(s.opportunityItems.number, numeros)) : eq(s.opportunityItems.opportunityId, opportunityId));
    }

    let newDocuments = 0;
    if (Array.isArray(p?.arquivos)) {
      for (const d of result.documents) {
        const [existente] = await db
          .select({ id: s.documents.id })
          .from(s.documents)
          .where(and(eq(s.documents.opportunityId, opportunityId), isNull(s.documents.companyId), eq(s.documents.sourceUrl, d.sourceUrl)))
          .limit(1);
        if (existente) {
          await db.update(s.documents).set({ title: d.title, kind: d.kind, updatedAt: sql`now()` }).where(eq(s.documents.id, existente.id));
          continue;
        }
        const [doc] = await db
          .insert(s.documents)
          .values({ opportunityId, companyId: null, kind: d.kind, origin: 'source', title: d.title, sourceUrl: d.sourceUrl, mimeType: d.mimeType })
          .returning({ id: s.documents.id });
        newDocuments += 1;
        await enqueueWith(deps.boss, 'document.fetch', { documentId: doc!.id }, { tx: client });
      }
    }

    if (contentChanged) await enqueueWith(deps.boss, 'match.score', { opportunityId }, { tx: client });
    await marcar({ normalizationStatus: 'normalized', normalizationError: null, opportunityId });
    await client.query('commit');
    log('info', 'source.normalized', { sourceRecordId, opportunityId, created, contentChanged, newDocuments, items });
    return { status: 'normalized', opportunityId, created, contentChanged, newDocuments, items };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Registra erro definitivo (payload inválido para o banco etc.) sem perder o registro. */
export async function markNormalizationError(pool: Pool, sourceRecordId: string, message: string): Promise<void> {
  await pool.query(`update source_records set normalization_status = 'error', normalization_error = $2, normalized_at = now() where id = $1 and normalization_status = 'pending'`, [sourceRecordId, message.slice(0, 500)]);
}
