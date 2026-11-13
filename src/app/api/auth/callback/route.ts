import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { FLOW_COOKIE, readAuthConfig, SESSION_MAX_AGE_S, sessionCookieName } from '@/server/auth/config';
import { AuthError } from '@/server/auth/errors';
import { CALLBACK_PATH, finishLogin } from '@/server/auth/oidc';
import { createSession, provisionUser } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/callback — retorno do Keycloak. Cria a sessão e redireciona para `returnTo`. */
export async function GET(request: Request) {
  const cfg = readAuthConfig();
  // Reconstrói a URL sobre APP_URL: atrás de proxy, request.url pode trazer host interno.
  const current = new URL(CALLBACK_PATH + new URL(request.url).search, cfg.appUrl);
  const flowToken = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${FLOW_COOKIE}=([^;]+)`))?.[1];
  try {
    const { claims, returnTo } = await finishLogin(cfg, current, flowToken);
    const db = getDb();
    const user = await provisionUser(db, claims);
    const { token } = await createSession(db, user.id, claims.realmRoles);
    const res = NextResponse.redirect(new URL(returnTo, cfg.appUrl), 302);
    res.cookies.set(sessionCookieName(cfg), token, {
      httpOnly: true,
      secure: cfg.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_S,
    });
    res.cookies.set(FLOW_COOKIE, '', { path: '/api/auth', maxAge: 0 });
    return res;
  } catch (e) {
    const err = e instanceof AuthError ? e : new AuthError('LOGIN_FAILED', 400, 'Não foi possível concluir o login.');
    if (!(e instanceof AuthError)) console.error('[auth] callback:', e instanceof Error ? e.message : e);
    const res = NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    res.cookies.set(FLOW_COOKIE, '', { path: '/api/auth', maxAge: 0 });
    return res;
  }
}
