/**
 * Estado do fluxo OIDC (PKCE verifier, state, nonce, returnTo) em cookie cifrado e de curta duração.
 * JWE `dir` + A256GCM com chave derivada de AUTH_SECRET: confidencial e à prova de adulteração.
 */
import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { FLOW_MAX_AGE_S } from './config';

export type FlowState = { verifier: string; state: string; nonce: string; returnTo: string };

const key = (secret: string) => createHash('sha256').update(`nett-auth-flow:${secret}`).digest();

export async function sealFlow(flow: FlowState, secret: string): Promise<string> {
  return new EncryptJWT({ ...flow })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${FLOW_MAX_AGE_S}s`)
    .encrypt(key(secret));
}

export async function openFlow(token: string | undefined, secret: string): Promise<FlowState | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key(secret));
    const { verifier, state, nonce, returnTo } = payload as Partial<FlowState>;
    if (![verifier, state, nonce, returnTo].every((v) => typeof v === 'string')) return null;
    return { verifier, state, nonce, returnTo } as FlowState;
  } catch {
    return null;
  }
}
