/**
 * Integração com Postgres (DATABASE_URL_TEST, papel nett_app) e, se KEYCLOAK_TEST=1, com o Keycloak local
 * (realm de docker/keycloak). Executar: npm run test:auth:integration
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Db } from '../db';
import * as s from '../db/schema';
import { readAuthConfig } from './config';
import { authorizeCompany } from './guard';
import { finishLogin, startLogin } from './oidc';
import { createSession, listAccessibleCompanies, provisionUser, resolveSession, revokeSession, type Session } from './session';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST não configurada');
const pool = new Pool({ connectionString: url, max: 2 });
const db = drizzle(pool, { schema: s, casing: 'snake_case' }) as unknown as Db;
const run = `${Date.now()}`.slice(-9);
let companyA: string, companyB: string, suspended: string;

const sessionFor = (id: string, roles: Session['realmRoles'] = []): Session => ({ id: 'x', user: { id, email: 'e', name: 'n' }, realmRoles: roles, expiresAt: new Date() });
const rejects403 = (p: Promise<unknown>) => assert.rejects(p, (e: { status?: number }) => e.status === 403);

before(async () => {
  const mk = (n: string, status: 'active' | 'suspended' = 'active') =>
    db.insert(s.companies).values({ legalName: n, cnpj: `${n.charCodeAt(0)}${run}`.padEnd(14, '7').slice(0, 14), size: 'EPP', status }).returning({ id: s.companies.id });
  [{ id: companyA }] = await mk('A');
  [{ id: companyB }] = await mk('B');
  [{ id: suspended }] = await mk('S', 'suspended');
});
after(() => pool.end());

test('provisionamento idempotente pelo sub; usuário inativo é barrado', async () => {
  const u1 = await provisionUser(db, { sub: `sub-${run}`, email: 'a@x.test', name: 'A' });
  const u2 = await provisionUser(db, { sub: `sub-${run}`, email: 'novo@x.test', name: 'A2' });
  assert.equal(u1.id, u2.id);
  assert.equal(u2.email, 'novo@x.test');
  await db.update(s.userAccounts).set({ active: false }).where(eq(s.userAccounts.id, u1.id));
  await assert.rejects(provisionUser(db, { sub: `sub-${run}`, email: 'a@x.test', name: 'A' }), (e: { code?: string }) => e.code === 'USER_INACTIVE');
});

test('sessão: só hash no banco; expira por idade, ociosidade e revogação', async () => {
  const u = await provisionUser(db, { sub: `sess-${run}`, email: 's@x.test', name: 'S' });
  const t0 = new Date('2026-11-13T12:00:00Z');
  const { token } = await createSession(db, u.id, ['nett_consultant'], t0);
  const [row] = await db.select().from(s.sessions).where(eq(s.sessions.userId, u.id));
  assert.notEqual(row.tokenHash, token);
  const ok = await resolveSession(db, token, new Date(t0.getTime() + 10 * 60_000));
  assert.deepEqual(ok?.realmRoles, ['nett_consultant']);
  assert.equal(await resolveSession(db, token, new Date(t0.getTime() + 8 * 3600_000 + 1)), null, 'idade');
  const { token: t2 } = await createSession(db, u.id, [], t0);
  assert.equal(await resolveSession(db, t2, new Date(t0.getTime() + 31 * 60_000)), null, 'ociosa');
  const { token: t3 } = await createSession(db, u.id, []);
  await revokeSession(db, t3);
  assert.equal(await resolveSession(db, t3), null, 'revogada');
  assert.equal(await resolveSession(db, 'inexistente'), null);
  assert.equal(await resolveSession(db, undefined), null);
});

test('authorizeCompany: membro, hierarquia de papel, outra empresa, suspensa, admin', async () => {
  const u = await provisionUser(db, { sub: `authz-${run}`, email: 'z@x.test', name: 'Z' });
  await db.insert(s.memberships).values([
    { userId: u.id, companyId: companyA, role: 'consultant' },
    { userId: u.id, companyId: suspended, role: 'company_admin' },
  ]);
  const sess = sessionFor(u.id, ['nett_consultant']);
  assert.equal(await authorizeCompany(db, sess, companyA, 'viewer'), 'consultant');
  assert.equal(await authorizeCompany(db, sess, companyA, 'consultant'), 'consultant');
  await rejects403(authorizeCompany(db, sess, companyA, 'company_admin'));
  await rejects403(authorizeCompany(db, sess, companyB, 'viewer'));
  await rejects403(authorizeCompany(db, sess, suspended, 'viewer'));
  await rejects403(authorizeCompany(db, sess, 'nao-e-uuid', 'viewer'));
  assert.equal(await authorizeCompany(db, sessionFor(u.id, ['nett_admin']), companyB, 'company_admin'), 'company_admin');
  const visiveis = (await listAccessibleCompanies(db, sess)).map((c) => c.id);
  assert.deepEqual(visiveis, [companyA]);
});

const kc = process.env.KEYCLOAK_TEST === '1';

/** Simula o navegador no formulário de login do Keycloak e devolve a URL de callback. */
async function browserLogin(authUrl: URL, username: string, password: string): Promise<URL> {
  const jar = new Map<string, string>();
  const keep = (r: Response) => r.headers.getSetCookie().forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); });
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const page = await fetch(authUrl, { redirect: 'manual' });
  keep(page);
  const html = await page.text();
  const action = html.match(/id="kc-form-login"[^>]*action="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  assert.ok(action, 'formulário de login não encontrado');
  const post = await fetch(action, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body: new URLSearchParams({ username, password, credentialId: '' }),
  });
  const loc = post.headers.get('location');
  assert.ok(loc && post.status === 302, `login falhou (HTTP ${post.status})`);
  return new URL(loc);
}

test('OIDC real no Keycloak: login, papéis no ID token, state e reuso de código', { skip: !kc && 'defina KEYCLOAK_TEST=1 com npm run infra:up' }, async () => {
  const cfg = readAuthConfig({
    APP_URL: 'http://localhost:3000', KEYCLOAK_ISSUER: 'http://localhost:8180/realms/nett',
    KEYCLOAK_CLIENT_ID: 'nett-licita-web', KEYCLOAK_CLIENT_SECRET: 'local-dev-client-secret', AUTH_SECRET: 'k'.repeat(40),
  } as unknown as NodeJS.ProcessEnv);
  const { redirectUrl, flowToken } = await startLogin(cfg, '/radar');
  assert.equal(redirectUrl.searchParams.get('code_challenge_method'), 'S256');
  const cb = await browserLogin(redirectUrl, 'consultor', 'consultor_local_123');
  assert.equal(cb.origin + cb.pathname, 'http://localhost:3000/api/auth/callback');

  const tampered = new URL(cb);
  tampered.searchParams.set('state', 'outro');
  await assert.rejects(finishLogin(cfg, tampered, flowToken), (e: { code?: string }) => e.code === 'LOGIN_FAILED');

  const { claims, returnTo } = await finishLogin(cfg, cb, flowToken);
  assert.equal(returnTo, '/radar');
  assert.equal(claims.email, 'consultor@nett.local');
  assert.deepEqual(claims.realmRoles, ['nett_consultant']);

  await assert.rejects(finishLogin(cfg, cb, flowToken), (e: { code?: string }) => e.code === 'LOGIN_FAILED', 'código reutilizado');
  await assert.rejects(finishLogin(cfg, cb, undefined), (e: { code?: string }) => e.code === 'LOGIN_FAILED', 'sem cookie de fluxo');

  const u = await provisionUser(db, claims);
  const { token } = await createSession(db, u.id, claims.realmRoles);
  assert.equal((await resolveSession(db, token))?.user.email, 'consultor@nett.local');
});
