/** /api/v1/sources: leitura pública (sem config nem cursor) e pedido de sincronização (nett_admin). */
import { asc } from 'drizzle-orm';
import type { SourceView } from '@/contracts/api';
import type { Db } from '../../db';
import { sources } from '../../db/schema';

export async function listSources(db: Db): Promise<{ items: SourceView[]; nextCursor: null }> {
  const rows = await db.select().from(sources).orderBy(asc(sources.key));
  return {
    items: rows.map((s) => ({
      key: s.key,
      name: s.name,
      kind: s.kind,
      enabled: s.enabled,
      lastSyncAt: s.lastSyncAt ? s.lastSyncAt.toISOString() : null,
      lastSyncStatus: s.lastSyncStatus,
    })),
    nextCursor: null,
  };
}
