/**
 * Integração com Next.js (Route Handlers / Server Components). Mantida fina: a lógica testável
 * está em session.ts e guard.ts.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getDb } from '../db';
import { consumeRateLimit, RULES, type RateLimitRule } from '../http/rate-limit';
import { requestContext } from '../http/request';
import { readAuthConfig, sessionCookieName } from './config';
import { HttpError } from '../http/errors';
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

function cookieValue(request: Request, name: string): string | undefined {
  for (const part of request.headers.get('cookie')?.split(';') ?? []) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * Aplica limite de requisições. Sujeito: sessão (hash do token) ou IP (HMAC). Sem DATABASE_URL não limita.
 * Retorna resposta 429 ou null.
 */
export async function enforceRateLimit(request: Request, rule: RateLimitRule, by: 'session_or_ip' | 'ip' = 'session_or_ip'): Promise<Response | null> {
  if (!process.env.DATABASE_URL) return null;
  const token = by === 'session_or_ip' ? cookieValue(request, sessionCookieName(readAuthConfig())) : undefined;
  const subject = token ? `s:${createHash('sha256').update(token).digest('hex')}` : `i:${requestContext(request).ipHash ?? 'desconhecido'}`;
  const r = await consumeRateLimit(getDb(), rule, subject);
  if (r.allowed) return null;
  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Muitas requisições. Tente novamente em instantes.' } },
    { status: 429, headers: { 'Retry-After': String(r.retryAfterSeconds) } },
  );
}

/** Envelopa Route Handlers de /api/v1: origem, limite de requisições e erros em `apiError`. */
export function withApi<C>(handler: (request: Request, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    try {
      assertSameOrigin(request);
      const limited = await enforceRateLimit(request, RULES.api);
      if (limited) return limited;
      return await handler(request, ctx);
    } catch (e) {
      if (e instanceof HttpError) {
        const error = { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) };
        return NextResponse.json({ error }, { status: e.status });
      }
      console.error('[api] erro não tratado:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: { code: 'INTERNAL', message: 'Erro interno.' } }, { status: 500 });
    }
  };
}
