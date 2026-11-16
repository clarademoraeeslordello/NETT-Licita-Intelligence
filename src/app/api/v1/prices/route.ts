import { NextResponse } from 'next/server';
import { priceQuery } from '@/contracts/api';
import { requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { InvalidCursor } from '@/server/sources/read/cursor';
import { apiError, parseQuery } from '@/server/sources/read/http';
import { listPrices } from '@/server/sources/read/prices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/prices?q=&ufs= — preços homologados por descrição de item, com resumo. Qualquer sessão. */
export const GET = withApi(async (request: Request) => {
  await requireSession();
  const q = parseQuery(priceQuery, new URL(request.url).searchParams);
  if (!q.ok) return q.response;
  try {
    return NextResponse.json(await listPrices(getDb(), q.data));
  } catch (e) {
    if (e instanceof InvalidCursor) return apiError(400, 'BAD_REQUEST', 'Cursor inválido.');
    throw e;
  }
});
