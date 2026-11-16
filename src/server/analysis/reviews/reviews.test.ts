/** T-304 unit tests (no database). Run: `npm run test:analysis` */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { reviewInput } from './dto';
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
