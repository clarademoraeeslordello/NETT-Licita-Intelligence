import { NextResponse } from 'next/server';
import { requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { apiError, isUuid } from '@/server/sources/read/http';
import { getOpportunity } from '@/server/sources/read/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/opportunities/{id} */
export const GET = withApi(async (_request: Request, { params }: Ctx) => {
  await requireSession();
  const { id } = await params;
  if (!isUuid(id)) return apiError(400, 'BAD_REQUEST', 'Identificador inválido.');
  const view = await getOpportunity(getDb(), id);
  return view ? NextResponse.json(view) : apiError(404, 'NOT_FOUND', 'Oportunidade não encontrada.');
});
