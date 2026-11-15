import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { readAuthConfig, sessionCookieName } from '@/server/auth/config';
import { assertSameOrigin } from '@/server/auth/next';
import { AuthError } from '@/server/auth/errors';
import { endSessionUrl } from '@/server/auth/oidc';
import { resolveSession, revokeSession } from '@/server/auth/session';
import { recordAuditSafe } from '@/server/audit';
import { requestContext } from '@/server/http/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — revoga a sessão local e encerra a sessão no Keycloak. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (e) {
    const err = e as AuthError;
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  const cfg = readAuthConfig();
  const name = sessionCookieName(cfg);
  const token = (await cookies()).get(name)?.value;
  const db = getDb();
  const session = await resolveSession(db, token);
  await revokeSession(db, token);
  if (session) await recordAuditSafe(db, { action: 'auth.logout', outcome: 'success', actorUserId: session.user.id, entityType: 'user', entityId: session.user.id, ...requestContext(request) });
  const res = NextResponse.redirect(await endSessionUrl(cfg), 303);
  res.cookies.set(name, '', { path: '/', maxAge: 0, secure: cfg.secureCookies, httpOnly: true, sameSite: 'lax' });
  return res;
}
