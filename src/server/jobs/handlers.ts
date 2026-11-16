/**
 * Handlers registrados no worker. Os de outros agentes (03, 04) entram aqui via PR deles,
 * importando de seus módulos. Filas sem handler acumulam até o dono registrar.
 */
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { JOB_DEFAULTS } from '@/contracts/jobs';
import type { SyncableConnector } from '../sources/connector';
import { markNormalizationError, normalizeSourceRecord } from '../sources/normalize-record';
import { PncpConnector } from '../sources/pncp/connector';
import { syncSource, type SyncLimits } from '../sources/sync';
import { drizzle } from 'drizzle-orm/node-postgres';
import { schema } from '../db';
import { fanOutProfile, refreshOpenOpportunities, scoreOpportunity } from '../matching';
import { enqueueWith } from './enqueue';
import { JobRegistry } from './registry';

export type HandlerDeps = {
  pool: Pool;
  boss: PgBoss;
  connectors?: ReadonlyMap<string, SyncableConnector>;
  limits?: Partial<SyncLimits>;
};

export function defaultConnectors(): ReadonlyMap<string, SyncableConnector> {
  const modalities = (process.env.PNCP_MODALITIES ?? '4,6,8')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const pncp = new PncpConnector({ modalities });
  return new Map([[pncp.key, pncp]]);
}

export function buildRegistry(deps: HandlerDeps): JobRegistry {
  const connectors = deps.connectors ?? defaultConnectors();
  return new JobRegistry()
    .register('source.sync', async (payload) => {
      await syncSource({ pool: deps.pool, boss: deps.boss, connectors, limits: deps.limits }, payload);
    })
    .register('source.normalize', async ({ sourceRecordId }, ctx) => {
      try {
        await normalizeSourceRecord({ pool: deps.pool, boss: deps.boss, connectors }, sourceRecordId);
      } catch (error) {
        // Última tentativa: registra o erro no SourceRecord (fica visível e reprocessável).
        if (ctx.retryCount >= JOB_DEFAULTS.retryLimit) await markNormalizationError(deps.pool, sourceRecordId, error instanceof Error ? error.message : String(error));
        throw error;
      }
    })
    // Agente 03 (T-305): uma nota por SearchProfile ativo; idempotente (mesmo hash/versão/perfil → não regrava).
    .register('match.score', async (payload) => {
      await scoreOpportunity(drizzle(deps.pool, { schema, casing: 'snake_case' }), payload);
    })
    // Agente 03 (contratos 1.4.0, ADR-025): só enfileiram match.score; quem pontua é o match.score.
    .register('match.refresh', async () => {
      await refreshOpenOpportunities({ db: drizzle(deps.pool, { schema, casing: 'snake_case' }), enqueue: (p) => enqueueWith(deps.boss, 'match.score', p) });
    })
    .register('match.profile', async ({ searchProfileId }) => {
      await fanOutProfile({ db: drizzle(deps.pool, { schema, casing: 'snake_case' }), enqueue: (p) => enqueueWith(deps.boss, 'match.score', p) }, searchProfileId);
    });
}

/** Agendamentos do agente 02 (cron em America/Sao_Paulo). Desligáveis com valor vazio. */
export function sourceSchedules(env: Record<string, string | undefined> = process.env) {
  const out: Array<{ name: 'source.sync'; cron: string; data: { sourceKey: string; mode: 'incremental' | 'backfill' } }> = [];
  const incremental = env.SOURCE_SYNC_CRON ?? '7 * * * *';
  const backfill = env.SOURCE_BACKFILL_CRON ?? '17 4 * * *';
  if (incremental) out.push({ name: 'source.sync', cron: incremental, data: { sourceKey: 'pncp', mode: 'incremental' } });
  if (backfill) out.push({ name: 'source.sync', cron: backfill, data: { sourceKey: 'pncp', mode: 'backfill' } });
  return out;
}
