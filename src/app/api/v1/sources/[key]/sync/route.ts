import { NextResponse } from 'next/server';
import { syncRequest } from '@/contracts/api';
import { badRequest, conflict, notFound, requireRealmRole, requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { requestContext } from '@/server/http/request';
import { requestSync } from '@/server/sources/read/sync-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

/** POST /api/v1/sources/{key}/sync — enfileira `source.sync`. Somente `nett_admin`; origem verificada por withApi. */
export const POST = withApi(async (request: Request, { params }: Ctx) => {
  const session = await requireSession();
  requireRealmRole(session, 'nett_admin');
  const { key } = await params;
  if (!/^[a-z0-9_]{2,40}$/.test(key)) throw badRequest('Fonte inválida.');
  const raw = await request.json().catch(() => ({}));
  const body = syncRequest.safeParse(raw ?? {});
  if (!body.success) throw badRequest('Corpo inválido.', body.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })));
  const r = await requestSync(getDb(), { sourceKey: key, ...body.data, actorUserId: session.user.id, ...requestContext(request) });
  if (r.status === 'unknown_source') throw notFound('Fonte não encontrada.');
  if (r.status === 'disabled') throw conflict('Fonte desabilitada.');
  return NextResponse.json({ jobId: r.jobId, sourceKey: key, mode: body.data.mode }, { status: 202 });
});
