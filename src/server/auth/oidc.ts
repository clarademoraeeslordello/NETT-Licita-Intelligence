/** Cliente OIDC do Keycloak (Authorization Code + PKCE S256 + state + nonce). */
import * as client from 'openid-client';
import { realmRole } from '../../contracts';
import type { AuthConfig } from './config';
import { AuthError } from './errors';
import { sealFlow, openFlow } from './flow';
import { safeReturnTo } from './return-to';

export const CALLBACK_PATH = '/api/auth/callback';

let cached: { key: string; config: Promise<client.Configuration> } | null = null;

export function oidcConfiguration(cfg: AuthConfig): Promise<client.Configuration> {
  const key = `${cfg.issuer.href}|${cfg.clientId}`;
  if (!cached || cached.key !== key) {
    const config = client
      .discovery(cfg.issuer, cfg.clientId, cfg.clientSecret, undefined, cfg.allowInsecureIssuer ? { execute: [client.allowInsecureRequests] } : undefined)
      .catch((e) => {
        cached = null;
        throw e;
      });
    cached = { key, config };
  }
  return cached.config;
}

export const callbackUrl = (cfg: AuthConfig) => new URL(CALLBACK_PATH, cfg.appUrl);

export async function startLogin(cfg: AuthConfig, returnTo: string | null): Promise<{ redirectUrl: URL; flowToken: string }> {
  const config = await oidcConfiguration(cfg);
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const redirectUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl(cfg).href,
    scope: 'openid email profile',
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  const flowToken = await sealFlow({ verifier, state, nonce, returnTo: safeReturnTo(returnTo) }, cfg.secret);
  return { redirectUrl, flowToken };
}

export type LoginClaims = { sub: string; email: string; name: string; realmRoles: Array<'nett_admin' | 'nett_consultant'> };

/**
 * Valida o retorno do Keycloak. `currentUrl` deve ser reconstruída sobre APP_URL
 * (não confiar no Host recebido atrás de proxy).
 */
export async function finishLogin(cfg: AuthConfig, currentUrl: URL, flowToken: string | undefined): Promise<{ claims: LoginClaims; returnTo: string }> {
  const flow = await openFlow(flowToken, cfg.secret);
  if (!flow) throw new AuthError('LOGIN_FAILED', 400, 'Fluxo de login expirado ou inválido. Tente novamente.');
  const config = await oidcConfiguration(cfg);
  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
  try {
    tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
  } catch (e) {
    console.error('[auth] troca de código falhou:', e instanceof Error ? `${e.name}: ${e.message}` : 'erro');
    throw new AuthError('LOGIN_FAILED', 400, 'Não foi possível concluir o login.');
  }
  const c = tokens.claims();
  if (!c?.sub || typeof c.email !== 'string') throw new AuthError('LOGIN_FAILED', 400, 'Token sem e-mail.');
  const roles = Array.isArray(c.realm_roles) ? c.realm_roles : [];
  return {
    claims: {
      sub: c.sub,
      email: c.email.toLowerCase(),
      name: typeof c.name === 'string' && c.name ? c.name : c.email,
      realmRoles: roles.filter((r): r is LoginClaims['realmRoles'][number] => realmRole.safeParse(r).success),
    },
    returnTo: flow.returnTo,
  };
}

export async function endSessionUrl(cfg: AuthConfig): Promise<URL> {
  const config = await oidcConfiguration(cfg);
  return client.buildEndSessionUrl(config, { client_id: cfg.clientId, post_logout_redirect_uri: new URL('/', cfg.appUrl).href });
}
