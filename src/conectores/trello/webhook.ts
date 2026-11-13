/**
 * Webhook do Trello.
 * Assinatura: header `x-trello-webhook` = base64(HMAC-SHA1(appSecret, corpoBruto + callbackURL)).
 * https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function assinaturaValida(corpoBruto: string, callbackUrl: string, segredo: string, assinatura: string | undefined): boolean {
  if (!segredo || !assinatura) return false;
  const esperado = createHmac('sha1', segredo).update(corpoBruto + callbackUrl, 'utf8').digest('base64');
  const a = Buffer.from(esperado);
  const b = Buffer.from(assinatura);
  return a.length === b.length && timingSafeEqual(a, b);
}
