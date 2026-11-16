import { NextResponse } from 'next/server';
import { pageQuery } from '@/contracts/api';
import { requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { InvalidCursor } from '@/server/sources/read/cursor';
import { apiError, isUuid, parseQuery } from '@/server/sources/read/http';
import { listItems, opportunityExists } from '@/server/sources/read/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/opportunities/{id}/items — itens por número, cursor = último número. */
export const GET = withApi(async (request: Request, { params }: Ctx) => {
  await requireSession();
  const { id } = await params;
  if (!isUuid(id)) return apiError(400, 'BAD_REQUEST', 'Identificador inválido.');
  const q = parseQuery(pageQuery(100, 500), new URL(request.url).searchParams);
  if (!q.ok) return q.response;
  const db = getDb();
  if (!(await opportunityExists(db, id))) return apiError(404, 'NOT_FOUND', 'Oportunidade não encontrada.');
  try {
    return NextResponse.json(await listItems(db, id, q.data.limit, q.data.cursor));
  } catch (e) {
    if (e instanceof InvalidCursor) return apiError(400, 'BAD_REQUEST', 'Cursor inválido.');
    throw e;
  }
});
