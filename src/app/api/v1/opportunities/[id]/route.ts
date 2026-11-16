import { NextResponse } from 'next/server';
import { notFound, requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { uuidParam } from '@/server/sources/read/http';
import { getOpportunity } from '@/server/sources/read/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/opportunities/{id} */
export const GET = withApi(async (_request: Request, { params }: Ctx) => {
  await requireSession();
  const id = uuidParam((await params).id);
  const view = await getOpportunity(getDb(), id);
  if (!view) throw notFound('Oportunidade não encontrada.');
  return NextResponse.json(view);
});
