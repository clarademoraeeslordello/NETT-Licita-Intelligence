/** Integração T-107/T-108 com Postgres (DATABASE_URL_TEST). Executar: npm run test:http:integration */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Db } from '../db';
import * as s from '../db/schema';
import { recordAudit, recordAuditSafe } from '../audit';
import { authorizeCompany } from '../auth/guard';
import { provisionUser } from '../auth/session';
import { consumeRateLimit } from './rate-limit';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST não configurada');
const pool = new Pool({ connectionString: url, max: 2 });
const db = drizzle(pool, { schema: s, casing: 'snake_case' }) as unknown as Db;
const run = `${Date.now()}`;
after(() => pool.end());

const rejectsMsg = (p: Promise<unknown>, re: RegExp) =>
  assert.rejects(p, (e: { message?: string; cause?: { message?: string } }) => re.test(`${e.message} ${e.cause?.message ?? ''}`));

test('audit_events: grava, sanitiza e é somente inclusão', async () => {
  await recordAudit(db, { action: 'teste.criado', outcome: 'success', entityId: run, metadata: { token: 'segredo', ok: true } });
  const [row] = await db.select().from(s.auditEvents).where(eq(s.auditEvents.entityId, run));
  assert.equal(row.actorType, 'system');
  assert.deepEqual(row.metadata, { token: '[removido]', ok: true });
  await rejectsMsg(db.update(s.auditEvents).set({ outcome: 'failure' }).where(eq(s.auditEvents.id, row.id)), /permission denied|somente inclusão/);
  await rejectsMsg(db.delete(s.auditEvents).where(eq(s.auditEvents.id, row.id)), /permission denied|somente inclusão/);
  await rejectsMsg(db.execute(sql`truncate audit_events`), /permission denied|must be owner/);
  await assert.rejects(recordAudit(db, { action: 'Invalida', outcome: 'success' }), /inválida/);
  await recordAuditSafe(db, { action: 'Invalida', outcome: 'success' }); // não lança
});

test('authz negada gera evento authz.denied com motivo', async () => {
  const u = await provisionUser(db, { sub: `audit-${run}`, email: 'a@x.test', name: 'A' });
  const session = { id: 'x', user: { id: u.id, email: u.email, name: u.name }, realmRoles: [], expiresAt: new Date() };
  await assert.rejects(authorizeCompany(db, session, '00000000-0000-4000-8000-000000000000', 'viewer'));
  await assert.rejects(authorizeCompany(db, session, 'lixo', 'viewer'));
  const rows = await db.select().from(s.auditEvents).where(and(eq(s.auditEvents.actorUserId, u.id), eq(s.auditEvents.action, 'authz.denied')));
  assert.deepEqual(rows.map((r) => (r.metadata as { reason: string }).reason).sort(), ['invalid_id', 'no_membership']);
  assert.ok(rows.every((r) => r.outcome === 'denied'));
});

test('rate limit: conta por janela, bloqueia acima do limite e reinicia na próxima janela', async () => {
  const rule = { name: `t${run}`, limit: 3, windowSeconds: 60 };
  const t0 = new Date('2026-11-15T10:00:05Z');
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(db, rule, 'sujeito', t0));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
  assert.equal(results[3].retryAfterSeconds, 55);
  assert.equal((await consumeRateLimit(db, rule, 'outro', t0)).allowed, true, 'sujeitos independentes');
  assert.equal((await consumeRateLimit(db, rule, 'sujeito', new Date('2026-11-15T10:01:00Z'))).allowed, true, 'nova janela');
  const concurrent = await Promise.all(Array.from({ length: 10 }, () => consumeRateLimit(db, { ...rule, name: `c${run}` }, 'x', t0)));
  assert.equal(concurrent.filter((r) => r.allowed).length, 3, 'atômico sob concorrência');
});
