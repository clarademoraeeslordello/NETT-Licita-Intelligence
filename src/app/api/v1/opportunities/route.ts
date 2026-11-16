import { NextResponse } from 'next/server';
import { opportunityListQuery } from '@/contracts/api';
import { requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { parseQuery } from '@/server/sources/read/http';
import { listOpportunities } from '@/server/sources/read/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/opportunities — listagem com filtros, situação efetiva (ADR-018) e cursor. Qualquer sessão. */
export const GET = withApi(async (request: Request) => {
  await requireSession();
  const q = parseQuery(opportunityListQuery, new URL(request.url).searchParams);
  return NextResponse.json(await listOpportunities(getDb(), q));
});
