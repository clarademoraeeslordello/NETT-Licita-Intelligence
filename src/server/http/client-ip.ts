/**
 * IP do cliente atrás de proxy. Railway acrescenta o IP real ao FINAL de X-Forwarded-For;
 * valores à esquerda são controlados pelo cliente. TRUSTED_PROXY_HOPS = nº de proxies confiáveis (padrão 1).
 */
import { createHmac } from 'node:crypto';

export function clientIp(headers: Headers, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): string | null {
  const xff = headers.get('x-forwarded-for');
  if (!xff || hops < 1) return null;
  const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
  const ip = parts[parts.length - hops];
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

/** HMAC-SHA256 com segredo do servidor: permite correlacionar sem guardar o IP. */
export function hashIdentifier(value: string, secret = process.env.AUTH_SECRET ?? ''): string {
  if (secret.length < 32) throw new Error('AUTH_SECRET ausente ou curto para hash de identificadores');
  return createHmac('sha256', secret).update(value).digest('hex');
}
