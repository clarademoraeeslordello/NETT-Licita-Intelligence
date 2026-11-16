/** T-304 unit tests (no database). Run: `npm run test:analysis` */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { reviewInput } from '@/contracts/api/reviews';
import { resolvePath, STATUS_BY_DECISION } from './service';

const id = '0190f5e2-7c1a-7cc3-9d2b-000000000001';
const base = { subjectType: 'ai_analysis', subjectId: id, decision: 'approved' };

describe('reviewInput', () => {
  test('aceita aprovação simples e normaliza comentário vazio para null', () => {
    const r = reviewInput.parse({ ...base, comment: '   ' });
    assert.equal(r.comment, null);
    assert.deepEqual(r.corrections, []);
  });

  test('rejected exige comentário; approved_with_changes exige correções', () => {
    assert.equal(reviewInput.safeParse({ ...base, decision: 'rejected' }).success, false);
    assert.equal(reviewInput.safeParse({ ...base, decision: 'rejected', comment: 'sem interesse' }).success, true);
    assert.equal(reviewInput.safeParse({ ...base, decision: 'approved_with_changes' }).success, false);
    const ok = reviewInput.safeParse({ ...base, decision: 'approved_with_changes', corrections: [{ path: 'a.b', previous: 1, corrected: 2 }] });
    assert.equal(ok.success, true);
  });

  test('revisor e empresa não são aceitos no corpo; caminho inválido e valores gigantes são recusados', () => {
    assert.equal(reviewInput.safeParse({ ...base, reviewerUserId: id }).success, false);
    assert.equal(reviewInput.safeParse({ ...base, companyId: id }).success, false);
    const bad = (path: string) => reviewInput.safeParse({ ...base, decision: 'approved_with_changes', corrections: [{ path, previous: 1, corrected: 2 }] }).success;
    assert.equal(bad('a.b[0].c'), true);
    for (const p of ['', '..a', '__proto__;x', 'a b', 'a[-1]', '1a']) assert.equal(bad(p), false, p);
    const huge = reviewInput.safeParse({ ...base, decision: 'approved_with_changes', corrections: [{ path: 'a', previous: 'x'.repeat(20_000), corrected: 'y' }] });
    assert.equal(huge.success, false);
  });
});

describe('resolvePath', () => {
  const doc = { datas: { fim: '30/11/2026' }, itens: [{ nome: 'a' }, { nome: 'b' }], nulo: null };
  test('resolve objetos, listas e null; ausência vira found=false', () => {
    assert.deepEqual(resolvePath(doc, 'datas.fim'), { found: true, value: '30/11/2026' });
    assert.deepEqual(resolvePath(doc, 'itens[1].nome'), { found: true, value: 'b' });
    assert.deepEqual(resolvePath(doc, 'nulo'), { found: true, value: null });
    for (const p of ['datas.inicio', 'itens[2]', 'itens.nome', 'datas.fim.x', 'toString', '__proto__']) assert.equal(resolvePath(doc, p).found, false, p);
  });
});

test('decisão → reviewStatus', () => {
  assert.deepEqual(STATUS_BY_DECISION, { approved: 'approved', approved_with_changes: 'approved_with_changes', rejected: 'rejected' });
});

/* ------------------------------- handlers (sem banco) ------------------------------- */
import { AuthError, unauthenticated } from '../../auth/errors';
import type { Session } from '../../auth/session';
import type { Db } from '../../db';
import { MAX_BODY, reviewsHandlers } from './handlers';
import { decodeCursor, encodeCursor, ReviewError } from './service';

const session: Session = { id: 's', user: { id: id, email: 'c@exemplo.test', name: 'C' }, realmRoles: [], expiresAt: new Date() };
const noDb = () => {
  throw new Error('o banco não deveria ser tocado');
};
const ctx = { params: Promise.resolve({ companyId: id }) };
const post = (body: string) => new Request('http://localhost/api/v1/companies/x/reviews', { method: 'POST', body, headers: { origin: 'http://localhost' } });
const get = (qs: string) => new Request(`http://localhost/api/v1/companies/x/reviews${qs}`);
const handlers = (over: Partial<Parameters<typeof reviewsHandlers>[0]> = {}) =>
  reviewsHandlers({ db: noDb as unknown as () => Db, requireSession: async () => session, authorize: async () => 'consultant', ...over });

describe('handlers HTTP', () => {
  test('401 sem sessão (POST e GET) e o banco não é tocado', async () => {
    const h = handlers({ requireSession: async () => Promise.reject(unauthenticated()) });
    for (const call of [h.POST(post('{}'), ctx), h.GET(get(''), ctx)]) await assert.rejects(call, (e) => e instanceof AuthError && e.status === 401 && e.code === 'UNAUTHENTICATED');
  });

  test('403 quando a autorização nega, antes de ler o corpo; POST pede consultant e GET pede viewer', async () => {
    const asked: string[] = [];
    const h = handlers({
      authorize: async (_s, _c, role) => {
        asked.push(role);
        throw new AuthError('FORBIDDEN', 403, 'Acesso negado.');
      },
    });
    await assert.rejects(h.POST(post('{"lixo":'), ctx), (e) => e instanceof AuthError && e.status === 403);
    await assert.rejects(h.GET(get('?x=1'), ctx), (e) => e instanceof AuthError && e.status === 403);
    assert.deepEqual(asked, ['consultant', 'viewer']);
  });

  test('422 para corpo inválido, 400 para JSON quebrado, 413 para corpo gigante', async () => {
    const h = handlers();
    const bodyOf = async (r: Response) => (await r.json()) as { error: { code: string; details?: { path: string }[] } };
    const invalid = await h.POST(post(JSON.stringify({ subjectType: 'ai_analysis', subjectId: id, decision: 'rejected' })), ctx);
    assert.equal(invalid.status, 422);
    const detail = await bodyOf(invalid);
    assert.equal(detail.error.code, 'VALIDATION');
    assert.ok(detail.error.details?.some((d) => d.path === 'comment'));
    assert.equal((await h.POST(post(JSON.stringify({ ...base, reviewerUserId: id })), ctx)).status, 422);
    assert.equal((await h.POST(post('{"a":'), ctx)).status, 400);
    assert.equal((await h.POST(post('x'.repeat(MAX_BODY + 1)), ctx)).status, 413);
  });

  test('GET: 422 sem assunto, com limite fora da faixa ou cursor inválido', async () => {
    const h = handlers();
    assert.equal((await h.GET(get(''), ctx)).status, 422);
    assert.equal((await h.GET(get(`?subjectType=ai_analysis&subjectId=${id}&limit=500`), ctx)).status, 422);
    assert.equal((await h.GET(get(`?subjectType=ai_analysis&subjectId=${id}&cursor=lixo`), ctx)).status, 422);
  });
});

describe('cursor', () => {
  test('ida e volta; recusa timestamp ou id fora do formato (sem injeção)', () => {
    const ts = '2026-11-16 13:47:22.123456+00';
    assert.deepEqual(decodeCursor(encodeCursor(ts, id)), { ts, id });
    for (const bad of [encodeCursor("2026-11-16'; drop table x;--", id), encodeCursor(ts, 'nao-uuid'), 'lixo', '']) assert.throws(() => decodeCursor(bad), (e) => e instanceof ReviewError && e.code === 'INVALID_CURSOR');
  });
});
