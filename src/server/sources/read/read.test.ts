/** T-204 — unidade (sem banco): situação efetiva, cursor, parâmetros de consulta. `npm run test:read` */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { opportunityListQuery, priceQuery, syncRequest } from '@/contracts/api';
import { HttpError } from '../../http/errors';
import { decodeCursor, encodeCursor, InvalidCursor } from './cursor';
import { parseQuery, uuidParam } from './http';
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

const erro400 = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError && e.status === 400 && e.code === 'BAD_REQUEST' ? e : null;
  }
  return null;
};

test('consulta de oportunidades: padrões, listas e limites', () => {
  assert.ok(erro400(() => parseQuery(opportunityListQuery, new URLSearchParams('ufs=rj,SP'))), 'UF minúscula é inválida');
  const d = parseQuery(opportunityListQuery, new URLSearchParams('q=%20software%20&ufs=RJ,SP&modalities=6,8&status=receiving_proposals,published&minValue=10.5&sort=close_asc&limit=5'));
  assert.deepEqual(
    { q: d.q, ufs: d.ufs, modalities: d.modalities, status: d.status, minValue: d.minValue, sort: d.sort, limit: d.limit },
    { q: 'software', ufs: ['RJ', 'SP'], modalities: [6, 8], status: ['receiving_proposals', 'published'], minValue: '10.5', sort: 'close_asc', limit: 5 },
  );
  const padrao = parseQuery(opportunityListQuery, new URLSearchParams(''));
  assert.ok(padrao.limit === 30 && padrao.sort === 'published_desc');
  for (const ruim of ['limit=0', 'limit=101', 'q=a', 'q=ab', 'status=tudo', 'minValue=1e3', 'modalities=x', 'sort=preco', 'closesFrom=ontem']) {
    assert.ok(erro400(() => parseQuery(opportunityListQuery, new URLSearchParams(ruim))), ruim);
  }
  const e = erro400(() => parseQuery(opportunityListQuery, new URLSearchParams('limit=0')))!;
  assert.deepEqual((e.details as Array<{ path: string }>).map((i) => i.path), ['limit'], 'details só com campo e mensagem');
});

test('consulta de preços exige 3+ caracteres; sync valida modo; uuid de rota', () => {
  assert.ok(erro400(() => parseQuery(priceQuery, new URLSearchParams('q=ab'))));
  assert.ok(erro400(() => parseQuery(priceQuery, new URLSearchParams(''))));
  assert.equal(parseQuery(priceQuery, new URLSearchParams('q=papel&ufs=RN')).q, 'papel');
  assert.deepEqual(syncRequest.parse({}), { mode: 'incremental' });
  assert.equal(syncRequest.safeParse({ mode: 'tudo' }).success, false);
  assert.equal(syncRequest.safeParse({ since: 'ontem' }).success, false);
  assert.equal(uuidParam('1c8e0a2f-3d4b-4c6e-9f70-8b9cad0e1f30'), '1c8e0a2f-3d4b-4c6e-9f70-8b9cad0e1f30');
  assert.ok(erro400(() => uuidParam('nao-uuid')));
});

test('cursor inválido é HttpError 400', () => {
  const e = new InvalidCursor();
  assert.ok(e instanceof HttpError && e.status === 400 && e.code === 'BAD_REQUEST');
});

test('escapeLike neutraliza curingas', () => {
  assert.equal(escapeLike('100%_off\\'), '100\\%\\_off\\\\');
});
