import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { readAuthConfig, sessionCookieName } from '@/server/auth/config';
import { assertSameOrigin } from '@/server/auth/next';
import { AuthError } from '@/server/auth/errors';
import { endSessionUrl } from '@/server/auth/oidc';
import { revokeSession } from '@/server/auth/session';

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
  await revokeSession(getDb(), (await cookies()).get(name)?.value);
  const res = NextResponse.redirect(await endSessionUrl(cfg), 303);
  res.cookies.set(name, '', { path: '/', maxAge: 0, secure: cfg.secureCookies, httpOnly: true, sameSite: 'lax' });
  return res;
}
