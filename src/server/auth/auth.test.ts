/** Unidade (sem banco/Keycloak). Executar: npm run test:auth */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAuthConfig } from './config';
import { AuthError, unauthenticated } from './errors';
import { openFlow, sealFlow } from './flow';
import { withApi } from './next';
import { safeReturnTo } from './return-to';

const secret = 'x'.repeat(40);
const env = { APP_URL: 'http://localhost:3000', KEYCLOAK_ISSUER: 'http://localhost:8180/realms/nett', KEYCLOAK_CLIENT_ID: 'c', KEYCLOAK_CLIENT_SECRET: 's', AUTH_SECRET: secret };

test('returnTo só aceita caminho interno', () => {
  assert.equal(safeReturnTo('/radar?uf=RN'), '/radar?uf=RN');
  for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '', null, '/a\nb']) {
    assert.equal(safeReturnTo(bad as string), '/', String(bad));
  }
});

test('fluxo OIDC cifrado: ida e volta, adulteração e segredo errado', async () => {
  const flow = { verifier: 'v', state: 's', nonce: 'n', returnTo: '/x' };
  const token = await sealFlow(flow, secret);
  assert.deepEqual(await openFlow(token, secret), flow);
  assert.equal(await openFlow(token, 'y'.repeat(40)), null);
  assert.equal(await openFlow(token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA'), secret), null);
  assert.equal(await openFlow(undefined, secret), null);
});

test('config: segredo curto e http em produção são rejeitados', () => {
  assert.throws(() => readAuthConfig({ ...env, AUTH_SECRET: 'curto' } as unknown as NodeJS.ProcessEnv), /AUTH_SECRET/);
  assert.throws(() => readAuthConfig({ ...env, NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv), /https/);
  const cfg = readAuthConfig(env as unknown as NodeJS.ProcessEnv);
  assert.equal(cfg.secureCookies, false);
  assert.equal(cfg.allowInsecureIssuer, true);
});

test('withApi: 401 sem sessão, 403 para origem estranha, 500 sem vazar detalhe', async () => {
  Object.assign(process.env, env);
  const r401 = await withApi(async () => { throw unauthenticated(); })(new Request('http://localhost:3000/api/v1/me'), {});
  assert.equal(r401.status, 401);
  assert.equal((await r401.json()).error.code, 'UNAUTHENTICATED');
  const post = (origin: string | null) => new Request('http://localhost:3000/api/v1/x', { method: 'POST', headers: origin ? { origin } : {} });
  const ok = withApi(async () => new Response('ok'));
  assert.equal((await ok(post('https://evil.test'), {})).status, 403);
  assert.equal((await ok(post(null), {})).status, 403);
  assert.equal((await ok(post('http://localhost:3000'), {})).status, 200);
  const r500 = await withApi(async () => { throw new Error('segredo interno'); })(new Request('http://localhost:3000/a'), {});
  assert.equal(r500.status, 500);
  assert.doesNotMatch(await r500.text(), /segredo interno/);
  assert.ok(new AuthError('FORBIDDEN', 403, 'x') instanceof Error);
});
