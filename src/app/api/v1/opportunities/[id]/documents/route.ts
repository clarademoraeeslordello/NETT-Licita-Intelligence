import { NextResponse } from 'next/server';
import { notFound, requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { uuidParam } from '@/server/sources/read/http';
import { listPublicDocuments, opportunityExists } from '@/server/sources/read/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/opportunities/{id}/documents — documentos públicos (sem chave de storage). */
export const GET = withApi(async (_request: Request, { params }: Ctx) => {
  await requireSession();
  const id = uuidParam((await params).id);
  const db = getDb();
  if (!(await opportunityExists(db, id))) throw notFound('Oportunidade não encontrada.');
  return NextResponse.json(await listPublicDocuments(db, id));
});
