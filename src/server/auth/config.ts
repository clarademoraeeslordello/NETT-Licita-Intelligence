/** Configuração de autenticação lida do ambiente (somente servidor). */
export type AuthConfig = {
  appUrl: URL;
  issuer: URL;
  clientId: string;
  clientSecret: string;
  secret: string;
  secureCookies: boolean;
  allowInsecureIssuer: boolean;
};

export const SESSION_MAX_AGE_S = 8 * 60 * 60;
export const SESSION_IDLE_S = 30 * 60;
export const FLOW_MAX_AGE_S = 10 * 60;

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} não configurada`);
    return v;
  };
  const appUrl = new URL(need('APP_URL'));
  const issuer = new URL(need('KEYCLOAK_ISSUER'));
  const secret = need('AUTH_SECRET');
  if (secret.length < 32) throw new Error('AUTH_SECRET deve ter pelo menos 32 caracteres');
  const production = env.NODE_ENV === 'production';
  if (production && (issuer.protocol !== 'https:' || appUrl.protocol !== 'https:')) {
    throw new Error('Em produção APP_URL e KEYCLOAK_ISSUER devem usar https');
  }
  return {
    appUrl,
    issuer,
    clientId: need('KEYCLOAK_CLIENT_ID'),
    clientSecret: need('KEYCLOAK_CLIENT_SECRET'),
    secret,
    secureCookies: appUrl.protocol === 'https:',
    allowInsecureIssuer: !production && issuer.protocol === 'http:',
  };
}

export const sessionCookieName = (cfg: Pick<AuthConfig, 'secureCookies'>) =>
  cfg.secureCookies ? '__Host-nett_session' : 'nett_session';
export const FLOW_COOKIE = 'nett_auth_flow';
