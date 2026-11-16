import { NextResponse } from 'next/server';
import { requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { apiError, isUuid } from '@/server/sources/read/http';
import { listPublicDocuments, opportunityExists } from '@/server/sources/read/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/opportunities/{id}/documents — documentos públicos (sem chave de storage). */
export const GET = withApi(async (_request: Request, { params }: Ctx) => {
  await requireSession();
  const { id } = await params;
  if (!isUuid(id)) return apiError(400, 'BAD_REQUEST', 'Identificador inválido.');
  const db = getDb();
  if (!(await opportunityExists(db, id))) return apiError(404, 'NOT_FOUND', 'Oportunidade não encontrada.');
  return NextResponse.json(await listPublicDocuments(db, id));
});
