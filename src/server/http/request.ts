/** Contexto de requisição para auditoria e limite: IP com hash e id da requisição (definido no middleware). */
import { clientIp, hashIdentifier } from './client-ip';

export type RequestContext = { ipHash: string | null; requestId: string | null };

export function requestContext(request: Request): RequestContext {
  const ip = clientIp(request.headers);
  let ipHash: string | null = null;
  try {
    ipHash = ip ? hashIdentifier(ip) : null;
  } catch {
    ipHash = null;
  }
  const rid = request.headers.get('x-request-id');
  return { ipHash, requestId: rid && /^[a-zA-Z0-9-]{8,64}$/.test(rid) ? rid : null };
}
