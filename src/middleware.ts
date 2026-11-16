/**
 * T-107 — Content-Security-Policy com nonce por requisição e id de requisição.
 * O Next.js lê o nonce do cabeçalho CSP da requisição e o aplica aos próprios scripts
 * (exige renderização dinâmica: ver `await headers()` em src/app/layout.tsx).
 * Dono: agente 01.
 */
import { NextResponse, type NextRequest } from 'next/server';

/** Relatório de impressão herdado usa script/estilo inline. Exceção removida em T-306. */
const LEGACY_INLINE = /^\/api\/jobs\/[^/]+\/report\.html$/;

export function buildCsp(nonce: string, opts: { dev: boolean; formActionOrigins: string[]; legacyInline?: boolean }): string {
  const script = opts.legacyInline
    ? ["'self'", "'unsafe-inline'"]
    : ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])];
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': script,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...(opts.dev ? ['ws:'] : [])],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'", ...opts.formActionOrigins],
  };
  const csp = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!opts.dev) csp.push('upgrade-insecure-requests');
  return csp.join('; ');
}

function issuerOrigin(): string[] {
  try {
    return process.env.KEYCLOAK_ISSUER ? [new URL(process.env.KEYCLOAK_ISSUER).origin] : [];
  } catch {
    return [];
  }
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const incoming = request.headers.get('x-request-id');
  const requestId = incoming && /^[a-zA-Z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV !== 'production',
    formActionOrigins: issuerOrigin(),
    legacyInline: LEGACY_INLINE.test(request.nextUrl.pathname),
  });

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  // Caminho e query da requisição para o layout montar o returnTo do login (T-403). Sempre sobrescritos:
  // um valor enviado pelo cliente nunca chega ao layout. O layout ainda sanitiza o que lê.
  headers.set('x-nett-pathname', request.nextUrl.pathname);
  headers.set('x-nett-search', request.nextUrl.search);
  headers.set('x-request-id', requestId);
  headers.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)' }],
};
