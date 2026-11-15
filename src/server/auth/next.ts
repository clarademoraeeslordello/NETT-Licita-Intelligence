/**
 * Integração com Next.js (Route Handlers / Server Components). Mantida fina: a lógica testável
 * está em session.ts e guard.ts.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '../db';
import { readAuthConfig, sessionCookieName } from './config';
import { AuthError, unauthenticated } from './errors';
import { authorizeCompany, type CompanyRole } from './guard';
import { resolveSession, type Session } from './session';

export async function getSession(): Promise<Session | null> {
  const cfg = readAuthConfig();
  const token = (await cookies()).get(sessionCookieName(cfg))?.value;
  return resolveSession(getDb(), token);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw unauthenticated();
  return session;
}

export async function requireCompanyAccess(session: Session, companyId: string, minRole: CompanyRole) {
  return authorizeCompany(getDb(), session, companyId, minRole);
}

/** Bloqueia requisições mutáveis de outra origem (defesa CSRF além do SameSite=Lax). */
export function assertSameOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  if (!origin || origin !== readAuthConfig().appUrl.origin) throw new AuthError('BAD_ORIGIN', 403, 'Origem não permitida.');
}

/** Envelopa Route Handlers de /api/v1: converte AuthError/erros em `apiError`. */
export function withApi<C>(handler: (request: Request, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    try {
      assertSameOrigin(request);
      return await handler(request, ctx);
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      }
      console.error('[api] erro não tratado:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: { code: 'INTERNAL', message: 'Erro interno.' } }, { status: 500 });
    }
  };
}
