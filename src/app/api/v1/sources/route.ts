import { NextResponse } from 'next/server';
import { requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { listSources } from '@/server/sources/read/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/sources — fontes e situação da última sincronização. Qualquer sessão. */
export const GET = withApi(async () => {
  await requireSession();
  return NextResponse.json(await listSources(getDb()));
});
