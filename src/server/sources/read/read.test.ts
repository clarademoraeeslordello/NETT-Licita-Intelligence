/** T-204 — unidade (sem banco): situação efetiva, cursor, parâmetros de consulta. `npm run test:read` */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { opportunityListQuery, priceQuery, syncRequest } from '@/contracts/api';
import { decodeCursor, encodeCursor, InvalidCursor } from './cursor';
import { parseQuery } from './http';
import { escapeLike } from './opportunities';
import { effectiveStatus } from './status';

const now = new Date('2026-11-16T15:00:00.000Z');
const at = (iso: string | null) => (iso === null ? null : iso);

test('effectiveStatus: published depende do relógio; outros passam direto (ADR-018)', () => {
  const cases: Array<[Parameters<typeof effectiveStatus>[0]['status'], string | null, string]> = [
    ['published', '2026-11-17T09:00:00.000Z', 'receiving_proposals'],
    ['published', '2026-11-16T15:00:00.001Z', 'receiving_proposals'],
    ['published', '2026-11-16T15:00:00.000Z', 'closed'], // instante alcançado = encerrada
    ['published', '2026-11-10T09:00:00.000Z', 'closed'],
    ['published', null, 'published'],
    ['awarded', '2026-12-30T09:00:00.000Z', 'awarded'],
    ['cancelled', '2026-12-30T09:00:00.000Z', 'cancelled'],
    ['suspended', '2026-12-30T09:00:00.000Z', 'suspended'],
    ['unknown', null, 'unknown'],
    ['closed', '2026-12-30T09:00:00.000Z', 'closed'],
    ['receiving_proposals', null, 'receiving_proposals'],
  ];
  for (const [status, close, esperado] of cases) assert.equal(effectiveStatus({ status, proposalsCloseAt: at(close) }, now), esperado, `${status} ${close}`);
  assert.equal(effectiveStatus({ status: 'published', proposalsCloseAt: new Date('2026-11-17T00:00:00Z') }, now), 'receiving_proposals', 'aceita Date');
});

test('cursor: ida e volta, ordenação diferente e lixo são rejeitados', () => {
  const c = encodeCursor({ s: 'published_desc', k: '2026-11-10T00:00:00.000Z', id: '1c8e0a2f-3d4b-4c6e-9f70-8b9cad0e1f30' });
  assert.deepEqual(decodeCursor(c, 'published_desc'), { v: 1, s: 'published_desc', k: '2026-11-10T00:00:00.000Z', id: '1c8e0a2f-3d4b-4c6e-9f70-8b9cad0e1f30' });
  assert.throws(() => decodeCursor(c, 'close_asc'), InvalidCursor);
  for (const ruim of ['', 'x', Buffer.from('{"v":2}').toString('base64url'), Buffer.from('nao json').toString('base64url')]) assert.throws(() => decodeCursor(ruim, 'published_desc'), InvalidCursor);
});

test('consulta de oportunidades: padrões, listas e limites', () => {
  const ok = parseQuery(opportunityListQuery, new URLSearchParams('q=%20software%20&ufs=rj,SP&modalities=6,8&status=receiving_proposals,published&minValue=10.5&limit=5'));
  assert.equal(ok.ok, false, 'UF minúscula é inválida');
  const certo = parseQuery(opportunityListQuery, new URLSearchParams('q=%20software%20&ufs=RJ,SP&modalities=6,8&status=receiving_proposals,published&minValue=10.5&sort=close_asc&limit=5'));
  assert.ok(certo.ok);
  if (!certo.ok) return;
  assert.deepEqual(
    { q: certo.data.q, ufs: certo.data.ufs, modalities: certo.data.modalities, status: certo.data.status, minValue: certo.data.minValue, sort: certo.data.sort, limit: certo.data.limit },
    { q: 'software', ufs: ['RJ', 'SP'], modalities: [6, 8], status: ['receiving_proposals', 'published'], minValue: '10.5', sort: 'close_asc', limit: 5 },
  );
  const padrao = parseQuery(opportunityListQuery, new URLSearchParams(''));
  assert.ok(padrao.ok && padrao.data.limit === 30 && padrao.data.sort === 'published_desc');
  for (const ruim of ['limit=0', 'limit=101', 'q=a', 'q=ab', 'status=tudo', 'minValue=1e3', 'modalities=x', 'sort=preco', 'closesFrom=ontem']) {
    assert.equal(parseQuery(opportunityListQuery, new URLSearchParams(ruim)).ok, false, ruim);
  }
});

test('consulta de preços exige 3+ caracteres; sync valida modo', () => {
  assert.equal(parseQuery(priceQuery, new URLSearchParams('q=ab')).ok, false);
  assert.equal(parseQuery(priceQuery, new URLSearchParams('')).ok, false);
  assert.ok(parseQuery(priceQuery, new URLSearchParams('q=papel&ufs=RN')).ok);
  assert.deepEqual(syncRequest.parse({}), { mode: 'incremental' });
  assert.equal(syncRequest.safeParse({ mode: 'tudo' }).success, false);
  assert.equal(syncRequest.safeParse({ since: 'ontem' }).success, false);
});

test('escapeLike neutraliza curingas', () => {
  assert.equal(escapeLike('100%_off\\'), '100\\%\\_off\\\\');
});
