import { NextResponse } from 'next/server';
import { FLOW_COOKIE, FLOW_MAX_AGE_S, readAuthConfig } from '@/server/auth/config';
import { startLogin } from '@/server/auth/oidc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/login?returnTo=/caminho — inicia o login no Keycloak. */
export async function GET(request: Request) {
  const cfg = readAuthConfig();
  const returnTo = new URL(request.url).searchParams.get('returnTo');
  const { redirectUrl, flowToken } = await startLogin(cfg, returnTo);
  const res = NextResponse.redirect(redirectUrl, 302);
  res.cookies.set(FLOW_COOKIE, flowToken, {
    httpOnly: true,
    secure: cfg.secureCookies,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: FLOW_MAX_AGE_S,
  });
  return res;
}
