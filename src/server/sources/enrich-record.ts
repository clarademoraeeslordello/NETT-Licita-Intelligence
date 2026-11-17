/**
 * `source.enrich` (T-211, ADR-021): retenta o enriquecimento (itens e arquivos) de um SourceRecord que casou com
 * um SearchProfile mas ficou só com a listagem porque a fonte falhou (ex.: PNCP 503).
 *
 * - Grava uma NOVA versão do SourceRecord com o payload enriquecido (a antiga nunca é alterada, invariante 2) e
 *   enfileira `source.normalize` na MESMA transação.
 * - Idempotente: se já existe versão enriquecida do mesmo `externalId` (ex.: o sync enriqueceu entretanto), não faz nada;
 *   o mesmo conteúdo gera o mesmo `payloadHash` e não duplica a linha.
 * - Só enriquece o que AINDA casa com algum perfil ativo (perfil removido/alterado → não gasta requisição à fonte).
 * - HTTP 429 nunca é retentado: reenfileira o MESMO job depois do cooldown (não consome as tentativas do pg-boss).
 * - Outras falhas lançam: o pg-boss retenta (3 tentativas, backoff). Esgotadas, o handler chama `recordEnrichFailure`
 *   (AuditEvent) e a oportunidade continua visível só com a listagem.
 */
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { recordAudit } from '../audit';
import * as s from '../db/schema';
import { enqueueWith } from '../jobs/enqueue';
import { log } from '../jobs/registry';
import { SourceRateLimited, type SyncableConnector } from './connector';
import { matchesAny } from './filter';
import { activeProfiles, payloadHash } from './sync';

export type EnrichDeps = { pool: Pool; boss: PgBoss; connectors: ReadonlyMap<string, SyncableConnector> };
export type EnrichOutcome =
  | { status: 'enriched'; sourceRecordId: string; newRecordId: string | null }
  | { status: 'missing' | 'already_enriched' | 'not_relevant' | 'not_supported' }
  | { status: 'rate_limited'; retryAfterMs: number };

export async function enrichSourceRecord(deps: EnrichDeps, sourceRecordId: string): Promise<EnrichOutcome> {
  const db = drizzle(deps.pool, { schema: s, casing: 'snake_case' });
  const [rec] = await db
    .select({ r: s.sourceRecords, sourceKey: s.sources.key })
    .from(s.sourceRecords)
    .innerJoin(s.sources, eq(s.sources.id, s.sourceRecords.sourceId))
    .where(eq(s.sourceRecords.id, sourceRecordId))
    .limit(1);
  if (!rec) return { status: 'missing' };
  const connector = deps.connectors.get(rec.sourceKey);
  if (!connector?.enrich) return { status: 'not_supported' };

  // Versão mais recente do mesmo registro: se já está enriquecida, não há o que fazer.
  const [atual] = await db
    .select({ payload: s.sourceRecords.payload })
    .from(s.sourceRecords)
    .where(and(eq(s.sourceRecords.sourceId, rec.r.sourceId), eq(s.sourceRecords.externalId, rec.r.externalId)))
    .orderBy(desc(s.sourceRecords.fetchedAt))
    .limit(1);
  if (connector.isEnriched?.(rec.r.payload) || connector.isEnriched?.(atual?.payload ?? rec.r.payload)) return { status: 'already_enriched' };

  // Ainda é relevante? (perfil pode ter sido desativado/alterado desde o sync.)
  const norm = connector.normalize(atual?.payload ?? rec.r.payload);
  if ('skip' in norm || !matchesAny(norm.opportunity, rec.sourceKey, await activeProfiles(deps.pool, rec.sourceKey))) return { status: 'not_relevant' };

  let enriquecido: unknown;
  try {
    // Parte da versão mais recente da listagem (pode ter mudado desde o registro que originou o job).
    enriquecido = await connector.enrich(atual?.payload ?? rec.r.payload);
  } catch (error) {
    if (error instanceof SourceRateLimited) {
      await enqueueWith(deps.boss, 'source.enrich', { sourceRecordId }, { startAfter: new Date(Date.now() + error.cooldownMs) });
      log('warn', 'source.enrich_rate_limited', { sourceRecordId, cooldownMs: error.cooldownMs });
      return { status: 'rate_limited', retryAfterMs: error.cooldownMs };
    }
    throw error; // transitório: pg-boss retenta
  }

  const client = await deps.pool.connect();
  try {
    await client.query('begin');
    const tx = drizzle(client, { schema: s, casing: 'snake_case' });
    const [novo] = await tx
      .insert(s.sourceRecords)
      .values({ sourceId: rec.r.sourceId, externalId: rec.r.externalId, payload: enriquecido, payloadHash: payloadHash(enriquecido) })
      .onConflictDoNothing({ target: [s.sourceRecords.sourceId, s.sourceRecords.externalId, s.sourceRecords.payloadHash] })
      .returning({ id: s.sourceRecords.id });
    if (novo) await enqueueWith(deps.boss, 'source.normalize', { sourceRecordId: novo.id }, { tx: client });
    await client.query('commit');
    log('info', 'source.enriched', { sourceRecordId, newRecordId: novo?.id ?? null });
    return { status: 'enriched', sourceRecordId, newRecordId: novo?.id ?? null };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Retentativas esgotadas: a oportunidade continua só com a listagem; deixa o rastro em `AuditEvent`. */
export async function recordEnrichFailure(pool: Pool, sourceRecordId: string, message: string): Promise<void> {
  await recordAudit(drizzle(pool, { schema: s, casing: 'snake_case' }), {
    action: 'source.enrich_failed',
    outcome: 'failure',
    actorType: 'job',
    entityType: 'source_record',
    entityId: sourceRecordId,
    metadata: { message: message.slice(0, 300) },
  });
}
