/** Pedido de sincronização manual (POST /api/v1/sources/{key}/sync). Só `nett_admin`. */
import { eq } from 'drizzle-orm';
import type { Db } from '../../db';
import { sources } from '../../db/schema';
import { recordAudit } from '../../audit';
import { enqueue } from '../../jobs/enqueue';
import { defaultConnectors } from '../../jobs/handlers';

export type SyncRequestResult = { status: 'accepted'; jobId: string } | { status: 'unknown_source' } | { status: 'disabled' };

export async function requestSync(
  db: Db,
  input: { sourceKey: string; mode: 'incremental' | 'backfill'; since?: string; actorUserId: string; ipHash: string | null; requestId: string | null },
  enqueueFn: typeof enqueue = enqueue,
): Promise<SyncRequestResult> {
  const [row] = await db.select({ id: sources.id, enabled: sources.enabled }).from(sources).where(eq(sources.key, input.sourceKey)).limit(1);
  // Fonte ainda sem linha em `sources` é aceita se houver conector registrado (a linha nasce na 1ª sincronização).
  if (!row && !defaultConnectors().has(input.sourceKey)) return { status: 'unknown_source' };
  if (row && !row.enabled) return { status: 'disabled' };
  const jobId = await enqueueFn('source.sync', { sourceKey: input.sourceKey, mode: input.mode, ...(input.since ? { since: input.since } : {}) });
  await recordAudit(db, {
    action: 'source.sync_requested',
    outcome: 'success',
    actorUserId: input.actorUserId,
    entityType: 'source',
    entityId: row?.id ?? input.sourceKey,
    ipHash: input.ipHash,
    requestId: input.requestId,
    metadata: { sourceKey: input.sourceKey, mode: input.mode, since: input.since ?? null, jobId },
  });
  return { status: 'accepted', jobId };
}
