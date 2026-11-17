/** T-217 sem banco: parâmetros do radar e a ordem do handler (authz → validação → banco). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session } from '../../auth/session';
import type { Db } from '../../db';
import { HttpError } from '../../http/errors';
import { DEFAULT_RADAR_STATUS, radarQuery } from './dto';
import { radarHandlers } from './handlers';

const CID = '11111111-1111-4111-8111-111111111111';

test('query: padrões e listas por vírgula', () => {
  const q = radarQuery.parse({});
  assert.equal(q.limit, 30);
  assert.equal(q.status, undefined, 'situação ausente = padrão do serviço (abertas)');
  assert.deepEqual([...DEFAULT_RADAR_STATUS], ['receiving_proposals', 'published']);
  const p = radarQuery.parse({ ufs: 'RN, PB', modalities: '6,8', category: 'lgpd,software', minScore: '70', status: 'closed', q: ' lgpd ' });
  assert.deepEqual(p.ufs, ['RN', 'PB']);
  assert.deepEqual(p.modalities, [6, 8]);
  assert.deepEqual(p.category, ['lgpd', 'software']);
  assert.equal(p.minScore, 70);
  assert.deepEqual(p.status, ['closed']);
  assert.equal(p.q, 'lgpd');
});

test('query: rejeita o que não faz sentido (parâmetro desconhecido, faixa, UF, categoria, uuid)', () => {
  for (const bad of [{ sort: 'x' }, { limit: '0' }, { limit: '101' }, { minScore: '101' }, { minScore: '-1' }, { ufs: 'XX' }, { category: 'outra' }, { status: 'nada' }, { q: 'ab' }, { profileId: 'x' }, { closesFrom: 'ontem' }, { companyId: CID }])
    assert.equal(radarQuery.safeParse(bad).success, false, JSON.stringify(bad));
});

test('handler: papel viewer; outra empresa → 403 antes da consulta; consulta inválida → 400 antes do banco', async () => {
  const calls: string[] = [];
  const h = radarHandlers({
    db: (() => {
      calls.push('db');
      throw new Error('o banco não deveria ser tocado');
    }) as unknown as () => Db,
    requireSession: async () => ({ user: { id: 'u' }, realmRoles: [] }) as unknown as Session,
    authorize: async (_s, companyId, role) => {
      calls.push(`authorize:${role}`);
      if (companyId !== CID) throw new HttpError('FORBIDDEN', 403, 'Acesso negado.');
    },
  });
  const status = (code: number) => (e: unknown) => e instanceof HttpError && e.status === code;
  await assert.rejects(h.GET(new Request('http://x/r?limit=0'), { params: Promise.resolve({ companyId: '99999999-9999-4999-8999-999999999999' }) }), status(403));
  await assert.rejects(h.GET(new Request('http://x/r?limit=0'), { params: Promise.resolve({ companyId: CID }) }), status(400));
  assert.deepEqual(calls, ['authorize:viewer', 'authorize:viewer']);
});
