import { NextResponse } from 'next/server';
import { opportunityListQuery } from '@/contracts/api';
import { requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { InvalidCursor } from '@/server/sources/read/cursor';
import { apiError, parseQuery } from '@/server/sources/read/http';
import { listOpportunities } from '@/server/sources/read/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/opportunities — listagem com filtros, situação efetiva (ADR-018) e cursor. Qualquer sessão. */
export const GET = withApi(async (request: Request) => {
  await requireSession();
  const q = parseQuery(opportunityListQuery, new URL(request.url).searchParams);
  if (!q.ok) return q.response;
  try {
    return NextResponse.json(await listOpportunities(getDb(), q.data));
  } catch (e) {
    if (e instanceof InvalidCursor) return apiError(400, 'BAD_REQUEST', 'Cursor inválido.');
    throw e;
  }
});
