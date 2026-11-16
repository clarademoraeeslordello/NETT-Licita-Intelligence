import { NextResponse } from 'next/server';
import { pageQuery } from '@/contracts/api';
import { notFound, requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { parseQuery, uuidParam } from '@/server/sources/read/http';
import { listItems, opportunityExists } from '@/server/sources/read/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/opportunities/{id}/items — itens por número, cursor = último número. */
export const GET = withApi(async (request: Request, { params }: Ctx) => {
  await requireSession();
  const id = uuidParam((await params).id);
  const q = parseQuery(pageQuery(100, 500), new URL(request.url).searchParams);
  const db = getDb();
  if (!(await opportunityExists(db, id))) throw notFound('Oportunidade não encontrada.');
  return NextResponse.json(await listItems(db, id, q.limit, q.cursor));
});
