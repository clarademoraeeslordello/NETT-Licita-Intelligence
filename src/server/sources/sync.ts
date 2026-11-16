/**
 * `source.sync` (T-202): pagina a fonte a partir do cursor salvo, grava SourceRecords imutáveis
 * (novos ou com payload alterado) e enfileira `source.normalize` na MESMA transação de cada página.
 *
 * - Enriquecimento (itens/documentos) só para registros que casam com algum SearchProfile ativo,
 *   com orçamento por execução (padrão 50 — meta de 50 oportunidades processadas por hora).
 *   Esgotado o orçamento, a execução para e o cursor fica na página atual: nada é descartado.
 * - Falha de enriquecimento: o registro é gravado só com a listagem e o enriquecimento é retentado
 *   quando o registro for relido; após a 1ª falha, o enriquecimento pausa até a próxima execução.
 * - `incremental` avança `sources.last_cursor`; `backfill` (since ou ontem) relê sem mexer no cursor.
 * - Uma execução incremental por fonte (advisory lock).
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import type { PgBoss } from 'pg-boss';
import type { JobPayload } from '@/contracts/jobs';
import { recordAudit } from '../audit';
import * as s from '../db/schema';
import { enqueueWith } from '../jobs/enqueue';
import { log } from '../jobs/registry';
import type { SyncableConnector } from './connector';
import { matchesAny, type ProfileFilter } from './filter';
import { contentHashOf } from './pncp/normalize';

export type SyncLimits = { maxPages: number; enrichBudget: number };
export const DEFAULT_SYNC_LIMITS: SyncLimits = {
  maxPages: Number(process.env.SOURCE_SYNC_MAX_PAGES ?? 200),
  enrichBudget: Number(process.env.SOURCE_SYNC_ENRICH_BUDGET ?? 50),
};

export type SyncDeps = {
  pool: Pool;
  boss: PgBoss;
  connectors: ReadonlyMap<string, SyncableConnector>;
  limits?: Partial<SyncLimits>;
  now?: () => Date;
};

export type SyncResult = {
  status: 'ok' | 'partial' | 'error' | 'skipped';
  reason?: string;
  pages: number;
  records: number;
  newRecords: number;
  matched: number;
  enriched: number;
  enrichErrors: number;
  stoppedBy: 'caught_up' | 'max_pages' | 'enrich_budget' | 'error' | null;
};

const dbOf = (c: PoolClient | Pool) => drizzle(c, { schema: s, casing: 'snake_case' });
export const payloadHash = (payload: unknown) => contentHashOf(payload);

/** Garante a linha em `sources` (dono: agente 02). Não altera `enabled` nem cursor existentes. */
export async function ensureSource(pool: Pool, c: SyncableConnector) {
  const db = dbOf(pool);
  const d = c.definition;
  const [row] = await db
    .insert(s.sources)
    .values({ key: c.key, name: d.name, kind: d.kind, baseUrl: d.baseUrl, rateLimit: d.rateLimit, config: d.config })
    .onConflictDoUpdate({ target: s.sources.key, set: { name: d.name, baseUrl: d.baseUrl, rateLimit: d.rateLimit, config: d.config, updatedAt: sql`now()` } })
    .returning();
  return row!;
}

async function activeProfiles(pool: Pool, sourceKey: string): Promise<ProfileFilter[]> {
  const rows = await dbOf(pool)
    .select({
      includeTerms: s.searchProfiles.includeTerms,
      excludeTerms: s.searchProfiles.excludeTerms,
      ufs: s.searchProfiles.ufs,
      modalityCodes: s.searchProfiles.modalityCodes,
      minValue: s.searchProfiles.minValue,
      maxValue: s.searchProfiles.maxValue,
      sourceKeys: s.searchProfiles.sourceKeys,
    })
    .from(s.searchProfiles)
    .where(and(eq(s.searchProfiles.active, true), sql`(cardinality(${s.searchProfiles.sourceKeys}) = 0 or ${sourceKey} = any(${s.searchProfiles.sourceKeys}))`));
  return rows as ProfileFilter[];
}

/** Payload da versão mais recente gravada deste externalId (ou null). */
async function latestPayload(pool: Pool, sourceId: string, externalId: string): Promise<{ payload: unknown } | null> {
  const [row] = await dbOf(pool)
    .select({ payload: s.sourceRecords.payload })
    .from(s.sourceRecords)
    .where(and(eq(s.sourceRecords.sourceId, sourceId), eq(s.sourceRecords.externalId, externalId)))
    .orderBy(desc(s.sourceRecords.fetchedAt))
    .limit(1);
  return row ?? null;
}

function lockKey(sourceKey: string): bigint {
  return createHash('sha256').update(`source.sync:${sourceKey}`).digest().readBigInt64BE(0);
}

export async function syncSource(deps: SyncDeps, payload: JobPayload<'source.sync'>): Promise<SyncResult> {
  const connector = deps.connectors.get(payload.sourceKey);
  const result: SyncResult = { status: 'ok', pages: 0, records: 0, newRecords: 0, matched: 0, enriched: 0, enrichErrors: 0, stoppedBy: null };
  if (!connector) return { ...result, status: 'skipped', reason: `conector desconhecido: ${payload.sourceKey}` };
  const limits = { ...DEFAULT_SYNC_LIMITS, ...deps.limits };
  const now = deps.now ?? (() => new Date());

  const source = await ensureSource(deps.pool, connector);
  if (!source.enabled) return { ...result, status: 'skipped', reason: 'fonte desabilitada' };

  const incremental = payload.mode === 'incremental';
  const lockClient = await deps.pool.connect();
  try {
    if (incremental) {
      const { rows } = await lockClient.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [lockKey(source.key).toString()]);
      if (!rows[0]?.ok) return { ...result, status: 'skipped', reason: 'sincronização incremental já em execução' };
    }

    const since = payload.since ? new Date(payload.since) : null;
    let cursor: unknown = incremental
      ? (source.lastCursor && !since ? connector.resumeCursor(source.lastCursor) : null) ?? connector.cursorFrom(since)
      : connector.cursorFrom(since ?? new Date(now().getTime() - 86_400_000));

    const profiles = await activeProfiles(deps.pool, source.key);
    let budget = limits.enrichBudget;
    let enrichPaused = false;

    try {
      paginas: while (true) {
        if (result.pages >= limits.maxPages) {
          result.stoppedBy = 'max_pages';
          break;
        }
        const page = await connector.fetchPage(cursor);
        result.pages += 1;
        const rows: Array<{ externalId: string; payload: unknown }> = [];
        let parouNoMeio = false;

        for (const record of page.records) {
          const listing = (p: unknown) => payloadHash(connector.listingOf ? connector.listingOf(p) : p);
          const latest = await latestPayload(deps.pool, source.id, record.externalId);
          const inalterado = latest !== null && listing(latest.payload) === listing(record.payload);
          const jaEnriquecido = latest !== null && Boolean(connector.isEnriched?.(latest.payload));

          const norm = connector.normalize(record.payload);
          const casa = !('skip' in norm) && Boolean(connector.enrich) && matchesAny(norm.opportunity, source.key, profiles);
          if (casa) result.matched += 1;

          // Nada mudou na fonte e não há enriquecimento pendente: não grava nova versão.
          const precisaEnriquecer = casa && !(inalterado && jaEnriquecido);
          if (inalterado && !precisaEnriquecer) {
            result.records += 1;
            continue;
          }

          let recordPayload = record.payload;
          if (precisaEnriquecer && !enrichPaused) {
            if (budget <= 0) {
              parouNoMeio = true;
              result.stoppedBy = 'enrich_budget';
              break;
            }
            try {
              recordPayload = await connector.enrich!(record.payload);
              budget -= 1;
              result.enriched += 1;
            } catch (error) {
              result.enrichErrors += 1;
              enrichPaused = true;
              log('warn', 'source.enrich_failed', { sourceKey: source.key, externalId: record.externalId, error: error instanceof Error ? error.message : String(error) });
            }
          }
          // Inalterado e o enriquecimento falhou/pausou: a versão anterior continua válida.
          if (inalterado && recordPayload === record.payload) {
            result.records += 1;
            continue;
          }
          rows.push({ externalId: record.externalId, payload: recordPayload });
        }

        // Grava a página e enfileira a normalização atomicamente.
        const client = await deps.pool.connect();
        try {
          await client.query('begin');
          const db = dbOf(client);
          for (const r of rows) {
            const inserted = await db
              .insert(s.sourceRecords)
              .values({ sourceId: source.id, externalId: r.externalId, payload: r.payload, payloadHash: payloadHash(r.payload) })
              .onConflictDoNothing({ target: [s.sourceRecords.sourceId, s.sourceRecords.externalId, s.sourceRecords.payloadHash] })
              .returning({ id: s.sourceRecords.id });
            result.records += 1;
            if (inserted[0]) {
              result.newRecords += 1;
              await enqueueWith(deps.boss, 'source.normalize', { sourceRecordId: inserted[0].id }, { tx: client });
            }
          }
          // Cursor: se a página foi interrompida ou é a última, fica nela (relida na próxima execução).
          const proximo = parouNoMeio || page.nextCursor === null ? cursor : page.nextCursor;
          if (incremental) {
            await db.update(s.sources).set({ lastCursor: proximo, updatedAt: sql`now()` }).where(eq(s.sources.id, source.id));
          }
          await client.query('commit');
          cursor = proximo;
        } catch (error) {
          await client.query('rollback');
          throw error;
        } finally {
          client.release();
        }

        if (parouNoMeio) break paginas;
        if (page.nextCursor === null) {
          result.stoppedBy = 'caught_up';
          break;
        }
      }
      result.status = result.stoppedBy === 'caught_up' && result.enrichErrors === 0 ? 'ok' : 'partial';
    } catch (error) {
      result.status = result.pages > 1 ? 'partial' : 'error';
      result.stoppedBy = 'error';
      result.reason = error instanceof Error ? error.message : String(error);
    }

    await dbOf(deps.pool).transaction(async (tx) => {
      await tx
        .update(s.sources)
        .set({ lastSyncAt: sql`now()`, lastSyncStatus: result.status === 'skipped' ? null : (result.status as 'ok' | 'partial' | 'error'), updatedAt: sql`now()` })
        .where(eq(s.sources.id, source.id));
      await recordAudit(tx, {
        action: 'source.sync',
        outcome: result.status === 'error' ? 'failure' : 'success',
        actorType: 'job',
        entityType: 'source',
        entityId: source.id,
        metadata: { sourceKey: source.key, mode: payload.mode, ...result },
      });
    });
    log(result.status === 'error' ? 'error' : 'info', 'source.sync', { sourceKey: source.key, mode: payload.mode, ...result });
    if (result.status === 'error') throw new Error(`source.sync ${source.key}: ${result.reason}`);
    return result;
  } finally {
    if (incremental) await lockClient.query('select pg_advisory_unlock($1)', [lockKey(source.key).toString()]).catch(() => {});
    lockClient.release();
  }
}
