/** T-216 sem banco: DTOs, guarda de reprocesso ("sem perfil ativo") e a ordem dos handlers (authz → validação → serviço). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SearchProfile } from '../../contracts';
import type { CompanyRole } from '../auth/guard';
import type { Session } from '../auth/session';
import type { Db } from '../db';
import { HttpError } from '../http/errors';
import { capabilityCreate, capabilityPatch, searchProfileCreate, searchProfilePatch } from './dto';
import { profilesHandlers } from './handlers';
import { changedMatchFields, reprocessDecision } from './service';

const CID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const U = '33333333-3333-4333-8333-333333333333';

const profile = (over: Partial<SearchProfile> = {}): SearchProfile => ({
  id: PID,
  companyId: CID,
  name: 'Notebooks',
  includeTerms: ['notebook', 'computador'],
  excludeTerms: [],
  ufs: ['SP', 'RJ'],
  modalityCodes: [],
  minValue: null,
  maxValue: null,
  sourceKeys: [],
  minScore: 50,
  alertChannel: 'none',
  ownerUserId: U,
  active: true,
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
  ...over,
});

/* --------------------------------- DTOs --------------------------------- */

test('create: aplica padrões, apara e remove termos repetidos', () => {
  const p = searchProfileCreate.parse({ name: '  Notebooks ', includeTerms: [' notebook ', 'Notebook', 'monitor'], ufs: ['SP', 'SP'] });
  assert.equal(p.name, 'Notebooks');
  assert.deepEqual(p.includeTerms, ['notebook', 'monitor']);
  assert.deepEqual(p.ufs, ['SP']);
  assert.deepEqual([p.excludeTerms, p.modalityCodes, p.sourceKeys], [[], [], []]);
  assert.deepEqual([p.minScore, p.alertChannel, p.active, p.minValue, p.maxValue], [50, 'none', true, null, null]);
});

test('create: rejeita sem termo de inclusão, campos desconhecidos, faixa invertida e UF inválida', () => {
  assert.equal(searchProfileCreate.safeParse({ name: 'x', includeTerms: [] }).success, false);
  assert.equal(searchProfileCreate.safeParse({ name: 'x', includeTerms: ['  '] }).success, false);
  assert.equal(searchProfileCreate.safeParse({ name: 'x', includeTerms: ['a'], companyId: CID }).success, false, 'empresa vem do caminho');
  assert.equal(searchProfileCreate.safeParse({ name: 'x', includeTerms: ['a'], ownerUserId: U }).success, false, 'dono é o usuário da sessão');
  assert.equal(searchProfileCreate.safeParse({ name: 'x', includeTerms: ['a'], minValue: '200', maxValue: '100' }).success, false);
  assert.equal(searchProfileCreate.safeParse({ name: 'x', includeTerms: ['a'], ufs: ['XX'] }).success, false);
  assert.equal(searchProfileCreate.safeParse({ name: 'x', includeTerms: ['a'], sourceKeys: ['PNCP; drop'] }).success, false);
  assert.equal(searchProfileCreate.safeParse({ name: 'x', includeTerms: ['a'], minScore: 101 }).success, false);
});

test('patch: precisa de ao menos um campo e não aceita campos fora do contrato', () => {
  assert.equal(searchProfilePatch.safeParse({}).success, false);
  assert.equal(searchProfilePatch.safeParse({ active: false }).success, true);
  assert.equal(searchProfilePatch.safeParse({ includeTerms: [] }).success, false, 'não deixa o perfil sem termos');
  assert.equal(searchProfilePatch.safeParse({ ownerUserId: U }).success, false);
  assert.equal(searchProfilePatch.safeParse({ id: PID }).success, false);
});

test('capability: regras do contrato (financialIndicators e subject professional)', () => {
  assert.equal(capabilityCreate.safeParse({ kind: 'product', name: 'Notebooks' }).success, true);
  const fin = { referenceDate: '2025-12-31', currentLiquidity: '1.5', generalLiquidity: null, generalSolvency: null, netWorth: null };
  assert.equal(capabilityCreate.safeParse({ kind: 'product', name: 'x', financialIndicators: fin }).success, false);
  assert.equal(capabilityCreate.safeParse({ kind: 'financial_capacity', name: 'x', financialIndicators: fin }).success, true);
  assert.equal(capabilityCreate.safeParse({ kind: 'product', name: 'x', subject: 'professional' }).success, false);
  assert.equal(capabilityCreate.safeParse({ kind: 'certification', name: 'EXIN PDPF', subject: 'professional' }).success, true);
  assert.equal(capabilityCreate.safeParse({ kind: 'product', name: 'x', companyId: CID }).success, false);
  assert.equal(capabilityPatch.safeParse({}).success, false);
});

/* ------------------------ guarda "sem perfil ativo" ----------------------- */

test('guarda: perfil inativo nunca enfileira, nem na criação, nem na edição', () => {
  assert.equal(reprocessDecision(null, profile({ active: false }), true), 'skipped_inactive_profile');
  assert.equal(reprocessDecision(profile(), profile({ active: false, includeTerms: ['outro'] }), true), 'skipped_inactive_profile', 'desativar + mudar termos continua sem enfileirar');
  assert.equal(reprocessDecision(profile({ active: false }), profile({ active: false, ufs: ['MG'] }), true), 'skipped_inactive_profile');
});

test('guarda: empresa inativa não enfileira', () => {
  assert.equal(reprocessDecision(null, profile(), false), 'skipped_inactive_company');
  assert.equal(reprocessDecision(profile(), profile({ ufs: ['MG'] }), false), 'skipped_inactive_company');
});

test('guarda: criação ativa e reativação enfileiram', () => {
  assert.equal(reprocessDecision(null, profile(), true), 'queue');
  assert.equal(reprocessDecision(profile({ active: false }), profile({ active: true }), true), 'queue');
});

test('guarda: só enfileira quando muda algo que afeta o match', () => {
  const base = profile();
  for (const over of [{ includeTerms: ['servidor'] }, { excludeTerms: ['usado'] }, { ufs: ['MG'] }, { modalityCodes: [6] }, { minValue: '10.0000' }, { maxValue: '99' }, { sourceKeys: ['pncp'] }] satisfies Partial<SearchProfile>[]) {
    assert.equal(reprocessDecision(base, profile(over), true), 'queue', JSON.stringify(over));
  }
  for (const over of [{ name: 'Outro nome' }, { minScore: 80 }, { alertChannel: 'email' as const }]) {
    assert.equal(reprocessDecision(base, profile(over), true), 'skipped_unchanged', JSON.stringify(over));
  }
});

test('guarda: ordem de termos e de UFs não conta como mudança', () => {
  assert.deepEqual(changedMatchFields(profile(), profile({ includeTerms: ['computador', 'notebook'], ufs: ['RJ', 'SP'] })), []);
  assert.deepEqual(changedMatchFields(profile({ minValue: '1000' }), profile({ minValue: '1000.0000' })), [], 'decimal igual em grafia diferente');
  assert.deepEqual(changedMatchFields(profile({ includeTerms: ['licitação'] }), profile({ includeTerms: ['LICITACAO'] })), [], 'caixa e acento: o casamento normaliza');
  assert.deepEqual(changedMatchFields(profile({ includeTerms: ['licitação'] }), profile({ includeTerms: ['licitações'] })), [], 'plural: mesmo radical');
  assert.deepEqual(changedMatchFields(profile({ excludeTerms: ['usado'] }), profile({ excludeTerms: ['novo'] })), ['excludeTerms']);
  assert.deepEqual(changedMatchFields(profile({ minValue: null }), profile({ minValue: '0' })), ['minValue']);
});

/* --------------------------- ordem dos handlers --------------------------- */

function harness() {
  const calls: string[] = [];
  const session = { user: { id: U }, realmRoles: [] } as unknown as Session;
  const db = (() => {
    calls.push('db');
    throw new Error('o banco não deveria ser tocado');
  }) as unknown as () => Db;
  const h = profilesHandlers({
    db,
    requireSession: async () => {
      calls.push('session');
      return session;
    },
    authorize: async (_s: Session, companyId: string, role: CompanyRole) => {
      calls.push(`authorize:${role}`);
      if (companyId !== CID) throw new HttpError('FORBIDDEN', 403, 'Acesso negado.');
    },
    enqueueProfile: async () => {
      calls.push('enqueue');
    },
  });
  return { h, calls };
}
const ctx = (companyId = CID) => ({ params: Promise.resolve({ companyId }) });
const item = (id: string, companyId = CID) => ({ params: Promise.resolve({ companyId, id }) });
const post = (body: unknown, method = 'POST') => new Request('http://x/y', { method, headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const status = (code: number) => (e: unknown) => e instanceof HttpError && e.status === code;

test('handlers: papéis mínimos — GET viewer, POST/PATCH consultant', async () => {
  const { h, calls } = harness();
  await assert.rejects(h.listProfiles(new Request('http://x/y?limit=0'), ctx()), status(422)); // chegou na validação depois do authorize
  await assert.rejects(h.createProfile(post({}), ctx()), status(422));
  await assert.rejects(h.patchProfile(post({}, 'PATCH'), item(PID)), status(422));
  await assert.rejects(h.createCapability(post({}), ctx()), status(422));
  assert.deepEqual(
    calls.filter((c) => c.startsWith('authorize')),
    ['authorize:viewer', 'authorize:consultant', 'authorize:consultant', 'authorize:consultant'],
  );
  assert.ok(!calls.includes('db') && !calls.includes('enqueue'));
});

test('handlers: outra empresa → 403 antes de ler corpo, banco ou fila', async () => {
  const { h, calls } = harness();
  const other = '99999999-9999-4999-8999-999999999999';
  await assert.rejects(h.createProfile(post('não é json'), ctx(other)), status(403));
  await assert.rejects(h.patchProfile(post({ active: false }, 'PATCH'), item(PID, other)), status(403));
  await assert.rejects(h.listCapabilities(new Request('http://x/y'), ctx(other)), status(403));
  assert.ok(!calls.includes('db') && !calls.includes('enqueue'));
});

test('handlers: JSON inválido → 400; corpo grande → 413; id malformado → 404; tudo antes do banco', async () => {
  const { h, calls } = harness();
  await assert.rejects(h.createProfile(post('{nope'), ctx()), status(400));
  await assert.rejects(h.createProfile(post({ name: 'x'.repeat(200_000) }), ctx()), status(413));
  await assert.rejects(h.patchProfile(post({ active: false }, 'PATCH'), item('não-é-uuid')), status(404));
  await assert.rejects(h.getCapability(new Request('http://x/y'), item('1')), status(404));
  assert.ok(!calls.includes('db') && !calls.includes('enqueue'));
});

test('handlers: corpo com empresa ou dono é recusado (422), sem tocar o banco', async () => {
  const { h, calls } = harness();
  await assert.rejects(h.createProfile(post({ name: 'x', includeTerms: ['a'], companyId: '99999999-9999-4999-8999-999999999999' }), ctx()), status(422));
  await assert.rejects(h.createProfile(post({ name: 'x', includeTerms: ['a'], ownerUserId: U }), ctx()), status(422));
  assert.ok(!calls.includes('db') && !calls.includes('enqueue'));
});
