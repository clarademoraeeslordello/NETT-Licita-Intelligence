/**
 * T-216 com Postgres (DATABASE_URL_TEST, papel nett_app, banco migrado). Não se chama *.test.ts de propósito:
 * os testes sem banco não devem pegá-lo.
 * Rodar: npx tsx --test src/server/profiles/profiles.integration.ts
 *
 * Passa pelos handlers com a autorização REAL (`authorizeCompany` sobre memberships) e uma fila de mentira que registra
 * o que seria enfileirado. Limpeza: remove tudo que cria e que influencia outras suítes (perfis ativos, oportunidades,
 * fontes, capacidades, documentos). Empresas, usuários e vínculos ficam: `audit_events` é somente inclusão e os referencia.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { authorizeCompany } from '../auth/guard';
import type { Session } from '../auth/session';
import type { Db } from '../db';
import * as s from '../db/schema';
import { HttpError } from '../http/errors';
import { fanOutProfile, getMatchSummaries, scoreOpportunity } from '../matching';
import { profilesHandlers } from './handlers';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST não configurada');
const pool = new Pool({ connectionString: url, max: 4 });
const db = drizzle(pool, { schema: s, casing: 'snake_case' }) as unknown as Db;
const run = Date.now().toString().slice(-9);
const hash = 'e'.repeat(64);
const day = 86_400_000;

let A: string, B: string, consultant: string, viewer: string, outsider: string, evidenceDoc: string, otherDoc: string, src: string, opp: string;
const queue: string[] = [];
let failEnqueue = false;

const session = (userId: string) => ({ user: { id: userId }, realmRoles: [] }) as unknown as Session;
let current = () => session(consultant);
const h = profilesHandlers({
  db: () => db,
  requireSession: async () => current(),
  authorize: (sess, companyId, role) => authorizeCompany(db, sess, companyId, role),
  enqueueProfile: async (id) => {
    if (failEnqueue) throw new Error('boss indisponível');
    queue.push(id);
  },
});

const ctx = (companyId = A) => ({ params: Promise.resolve({ companyId }) });
const item = (id: string, companyId = A) => ({ params: Promise.resolve({ companyId, id }) });
const req = (method: string, body?: unknown, search = '') => new Request(`http://localhost/x${search}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (p: Promise<Response>) => {
  const r = await p;
  return { status: r.status, body: (await r.json()) as any };
};
const status = (code: number) => (e: unknown) => e instanceof HttpError && e.status === code;
const as = async <T>(userId: string, fn: () => Promise<T>) => {
  const prev = current;
  current = () => session(userId);
  try {
    return await fn();
  } finally {
    current = prev;
  }
};
const auditFor = (entityId: string, action: string) => db.select().from(s.auditEvents).where(and(eq(s.auditEvents.entityId, entityId), eq(s.auditEvents.action, action)));
const created = { profiles: [] as string[], capabilities: [] as string[] };
const newProfile = async (body: Record<string, unknown>, companyId = A) => {
  const r = await json(h.createProfile(req('POST', body), ctx(companyId)));
  if (r.status === 201) created.profiles.push(r.body.profile.id);
  return r;
};

before(async () => {
  [{ id: A }, { id: B }] = (await db
    .insert(s.companies)
    .values([
      { legalName: 'Empresa A', cnpj: `51${run}0001`.slice(0, 14).padEnd(14, '0'), size: 'EPP' },
      { legalName: 'Empresa B', cnpj: `52${run}0002`.slice(0, 14).padEnd(14, '0'), size: 'ME' },
    ])
    .returning({ id: s.companies.id })) as [{ id: string }, { id: string }];
  [{ id: consultant }, { id: viewer }, { id: outsider }] = (await db
    .insert(s.userAccounts)
    .values(['consultor', 'leitor', 'externo'].map((n) => ({ keycloakSub: `pf-${n}-${run}`, email: `${n}@exemplo.test`, name: n })))
    .returning({ id: s.userAccounts.id })) as [{ id: string }, { id: string }, { id: string }];
  await db.insert(s.memberships).values([
    { userId: consultant, companyId: A, role: 'consultant' },
    { userId: viewer, companyId: A, role: 'viewer' },
    { userId: consultant, companyId: B, role: 'consultant' }, // o mesmo consultor atende B: o isolamento é por caminho, não por usuário
  ]);
  [{ id: evidenceDoc }] = await db.insert(s.documents).values({ companyId: A, kind: 'annex', origin: 'upload', title: 'Atestado A', mimeType: 'application/pdf' }).returning({ id: s.documents.id });
  [{ id: otherDoc }] = await db.insert(s.documents).values({ companyId: B, kind: 'annex', origin: 'upload', title: 'Atestado B', mimeType: 'application/pdf' }).returning({ id: s.documents.id });
  [{ id: src }] = await db.insert(s.sources).values({ key: `pf_${run}`, name: 'PNCP', kind: 'api', rateLimit: { requestsPerMinute: 30, maxConcurrency: 3 } }).returning({ id: s.sources.id });
  [{ id: opp }] = await db
    .insert(s.opportunities)
    .values({
      canonicalKey: `pncp:pf${run}-2026-1`,
      primarySourceId: src,
      title: 'Pregão 77/2026',
      objectDescription: 'Consultoria para adequação à LGPD, mapeamento de dados pessoais, RIPD e DPO as a service',
      agencyName: 'Prefeitura Fictícia',
      sphere: 'municipal',
      status: 'receiving_proposals',
      uf: 'RN',
      modalityCode: 6,
      estimatedValue: '180000',
      proposalsCloseAt: new Date(Date.now() + 20 * day),
      url: 'https://pncp.gov.br/x',
      contentHash: hash,
    })
    .returning({ id: s.opportunities.id });
});

/** Roda mesmo quando um teste ou o `before` falha. Ordem de FK: notas (cascata do perfil) → oportunidade → fonte. */
after(async () => {
  try {
    const companyIds = [A, B].filter(Boolean);
    if (companyIds.length) {
      await db.delete(s.searchProfiles).where(inArray(s.searchProfiles.companyId, companyIds));
      await db.delete(s.companyCapabilities).where(inArray(s.companyCapabilities.companyId, companyIds));
      await db.delete(s.documents).where(inArray(s.documents.companyId, companyIds));
    }
    if (opp) await db.delete(s.opportunities).where(eq(s.opportunities.id, opp));
    if (src) await db.delete(s.sources).where(eq(s.sources.id, src));
  } finally {
    await pool.end();
  }
});

/* ------------------------------ autorização ------------------------------ */

test('papéis e isolamento: viewer lê e não escreve; quem não é da empresa não vê nada', async () => {
  const ok = await as(viewer, () => json(h.listProfiles(req('GET'), ctx())));
  assert.equal(ok.status, 200);
  await as(viewer, () => assert.rejects(h.createProfile(req('POST', { name: 'x', includeTerms: ['lgpd'] }), ctx()), status(403)));
  await as(viewer, () => assert.rejects(h.createCapability(req('POST', { kind: 'product', name: 'x' }), ctx()), status(403)));
  await as(outsider, () => assert.rejects(h.listProfiles(req('GET'), ctx()), status(403)));
  await as(viewer, () => assert.rejects(h.listProfiles(req('GET'), ctx(B)), status(403))); // viewer de A não tem vínculo com B
  const rows = await db.select({ id: s.searchProfiles.id }).from(s.searchProfiles).where(eq(s.searchProfiles.companyId, A));
  assert.equal(rows.length, 0, 'nenhuma escrita passou');
  assert.deepEqual(queue, []);
});

/* ------------------------------ SearchProfile ----------------------------- */

test('POST cria o perfil da empresa do caminho, com dono = sessão, audita e enfileira match.profile', async () => {
  queue.length = 0;
  const r = await newProfile({ name: 'LGPD Nordeste', includeTerms: ['lgpd', 'dpo'], ufs: ['RN', 'PB'], minValue: '1000' });
  assert.equal(r.status, 201);
  const p = r.body.profile;
  assert.equal(p.companyId, A);
  assert.equal(p.ownerUserId, consultant);
  assert.equal(p.active, true);
  assert.equal(p.minScore, 50);
  assert.equal(r.body.reprocess, 'queued');
  assert.deepEqual(queue, [p.id]);
  const [ev] = await auditFor(p.id, 'search_profile.created');
  assert.equal(ev!.actorUserId, consultant);
  assert.equal(ev!.companyId, A);
  assert.deepEqual(ev!.metadata, { active: true, includeTerms: 2, excludeTerms: 0 }, 'a auditoria não carrega os termos');
});

test('guarda "sem perfil ativo": criar inativo não enfileira', async () => {
  queue.length = 0;
  const r = await newProfile({ name: 'Rascunho', includeTerms: ['lgpd'], active: false });
  assert.equal(r.status, 201);
  assert.equal(r.body.reprocess, 'skipped_inactive_profile');
  assert.deepEqual(queue, []);
});

test('guarda: empresa suspensa (acesso de nett_admin) cria o perfil mas não enfileira', async () => {
  await db.update(s.companies).set({ status: 'suspended' }).where(eq(s.companies.id, B));
  try {
    const admin = { user: { id: consultant }, realmRoles: ['nett_admin'] } as unknown as Session;
    const prev = current;
    current = () => admin;
    queue.length = 0;
    try {
      const r = await json(h.createProfile(req('POST', { name: 'B', includeTerms: ['lgpd'] }), ctx(B)));
      assert.equal(r.status, 201);
      created.profiles.push(r.body.profile.id);
      assert.equal(r.body.reprocess, 'skipped_inactive_company');
      assert.deepEqual(queue, []);
    } finally {
      current = prev;
    }
  } finally {
    await db.update(s.companies).set({ status: 'active' }).where(eq(s.companies.id, B));
  }
});

test('PATCH: só reprocessa o que muda o match; nome, nota mínima e canal não enfileiram', async () => {
  const { body } = await newProfile({ name: 'Base', includeTerms: ['lgpd'], ufs: ['RN'], minValue: '1000' });
  const id = body.profile.id as string;
  const patch = (b: unknown) => json(h.patchProfile(req('PATCH', b), item(id)));

  queue.length = 0;
  let r = await patch({ name: 'Renomeado', minScore: 70, alertChannel: 'email' });
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.name, 'Renomeado');
  assert.equal(r.body.reprocess, 'skipped_unchanged');
  assert.deepEqual(queue, []);

  r = await patch({ includeTerms: ['lgpd', 'dpo'] });
  assert.equal(r.body.reprocess, 'queued');
  assert.deepEqual(queue, [id]);

  queue.length = 0;
  r = await patch({ ufs: ['RN'], minValue: '1000.0000', includeTerms: ['dpo', 'lgpd'] }); // mesmos valores, outra grafia/ordem
  assert.equal(r.body.reprocess, 'skipped_unchanged');
  assert.deepEqual(queue, []);
  assert.equal((await auditFor(id, 'search_profile.updated')).length, 2, 'o PATCH sem mudança real não gera auditoria');
});

test('PATCH sem mudança real não grava (updated_at intacto, nota existente continua válida)', async () => {
  const { body } = await newProfile({ name: 'Estável', includeTerms: ['lgpd'] });
  const id = body.profile.id as string;
  const [before] = await db.select({ u: s.searchProfiles.updatedAt }).from(s.searchProfiles).where(eq(s.searchProfiles.id, id));
  const r = await json(h.patchProfile(req('PATCH', { name: 'Estável', includeTerms: ['lgpd'] }), item(id)));
  assert.equal(r.body.reprocess, 'skipped_unchanged');
  const [after] = await db.select({ u: s.searchProfiles.updatedAt }).from(s.searchProfiles).where(eq(s.searchProfiles.id, id));
  assert.equal(after!.u.getTime(), before!.u.getTime());
});

test('PATCH só de caixa nos termos: grava a nova grafia, mas não reprocessa (o casamento ignora maiúsculas)', async () => {
  const { body } = await newProfile({ name: 'Caixa', includeTerms: ['lgpd'] });
  const id = body.profile.id as string;
  queue.length = 0;
  const r = await json(h.patchProfile(req('PATCH', { includeTerms: ['LGPD'] }), item(id)));
  assert.deepEqual(r.body.profile.includeTerms, ['LGPD']);
  assert.equal(r.body.reprocess, 'skipped_unchanged');
  assert.deepEqual(queue, []);
});

test('guarda: desativar não enfileira; reativar enfileira; desativado, o fan-out do worker também não faz nada', async () => {
  const { body } = await newProfile({ name: 'Liga/desliga', includeTerms: ['lgpd'], ufs: ['RN'], modalityCodes: [6] });
  const id = body.profile.id as string;
  const patch = (b: unknown) => json(h.patchProfile(req('PATCH', b), item(id)));

  queue.length = 0;
  let r = await patch({ active: false, includeTerms: ['outro termo'] }); // desativar E mudar termos: continua sem enfileirar
  assert.equal(r.body.reprocess, 'skipped_inactive_profile');
  assert.deepEqual(queue, []);
  const sent: unknown[] = [];
  const rec = async (p: unknown) => void sent.push(p); // closure: o assert.deepEqual abaixo não estreita o tipo de `sent` aqui dentro
  assert.deepEqual(await fanOutProfile({ db, enqueue: rec }, id), { enqueued: 0 });
  assert.deepEqual(sent, [], 'match.profile de perfil inativo é descartado no worker');

  r = await patch({ active: true, includeTerms: ['lgpd'] });
  assert.equal(r.body.reprocess, 'queued');
  assert.deepEqual(queue, [id]);
  // Outras suítes compartilham o banco e podem deixar oportunidades abertas: exige a nossa, não "só a nossa".
  const fan = await fanOutProfile({ db, enqueue: rec }, id);
  assert.ok(fan.enqueued >= 1 && fan.enqueued === sent.length, JSON.stringify(fan));
  assert.ok(sent.some((p) => JSON.stringify(p) === JSON.stringify({ opportunityId: opp, companyId: A })), 'a oportunidade aberta da suíte foi enfileirada para a empresa do perfil');
  assert.ok(sent.every((p) => (p as { companyId: string }).companyId === A), 'só para a empresa dona do perfil');
});

test('ponta a ponta: perfil criado pela API gera nota; ao desativar, a nota sai das leituras', async () => {
  const { body } = await newProfile({ name: 'E2E', includeTerms: ['lgpd'], ufs: ['RN'], modalityCodes: [6] });
  const id = body.profile.id as string;
  const run1 = await scoreOpportunity(db, { opportunityId: opp, companyId: A }); // o que o worker faz ao receber match.score
  assert.ok(run1.written >= 1, JSON.stringify(run1));
  assert.ok((await getMatchSummaries(db, A, [opp]))[opp], 'nota visível enquanto há perfil ativo');

  const off = await json(h.patchProfile(req('PATCH', { active: false }), item(id)));
  assert.equal(off.body.reprocess, 'skipped_inactive_profile');
  // Os outros perfis ativos de A que também casam continuam valendo; desativamos todos para provar o "sem perfil ativo".
  await db.update(s.searchProfiles).set({ active: false }).where(eq(s.searchProfiles.companyId, A));
  assert.deepEqual(await getMatchSummaries(db, A, [opp]), {}, 'sem perfil ativo, o radar não tem nota para a empresa');
  assert.equal((await scoreOpportunity(db, { opportunityId: opp, companyId: A })).written, 0, 'e o match.score não grava nada');
});

test('valores: faixa invertida pelo merge do PATCH → 422 e nada muda', async () => {
  const { body } = await newProfile({ name: 'Faixa', includeTerms: ['lgpd'], minValue: '500', maxValue: '900' });
  const id = body.profile.id as string;
  const [row0] = await db.select().from(s.searchProfiles).where(eq(s.searchProfiles.id, id));
  await assert.rejects(h.patchProfile(req('PATCH', { maxValue: '100' }), item(id)), status(422));
  await assert.rejects(h.patchProfile(req('PATCH', { minValue: '1000' }), item(id)), status(422));
  const [row1] = await db.select().from(s.searchProfiles).where(eq(s.searchProfiles.id, id));
  assert.deepEqual(row1, row0);
  assert.equal((await json(h.patchProfile(req('PATCH', { minValue: null, maxValue: '100' }), item(id)))).status, 200);
});

test('isolamento: o perfil de uma empresa é 404 no caminho de outra, no GET e no PATCH', async () => {
  const b = await json(h.createProfile(req('POST', { name: 'De B', includeTerms: ['lgpd'], active: false }), ctx(B)));
  assert.equal(b.status, 201);
  created.profiles.push(b.body.profile.id);
  const bId = b.body.profile.id as string;
  await assert.rejects(h.getProfile(req('GET'), item(bId, A)), status(404));
  await assert.rejects(h.patchProfile(req('PATCH', { name: 'invadido' }), item(bId, A)), status(404));
  const [row] = await db.select({ name: s.searchProfiles.name }).from(s.searchProfiles).where(eq(s.searchProfiles.id, bId));
  assert.equal(row!.name, 'De B');
  const listA = await json(h.listProfiles(req('GET'), ctx(A)));
  assert.ok(listA.body.items.every((p: { companyId: string }) => p.companyId === A));
  assert.equal((await json(h.getProfile(req('GET'), item(bId, B)))).status, 200);
});

test('falha ao enfileirar não perde o perfil: responde "failed" e audita', async () => {
  failEnqueue = true;
  try {
    const r = await newProfile({ name: 'Fila fora', includeTerms: ['lgpd'] });
    assert.equal(r.status, 201);
    assert.equal(r.body.reprocess, 'failed');
    const id = r.body.profile.id as string;
    assert.equal((await db.select().from(s.searchProfiles).where(eq(s.searchProfiles.id, id))).length, 1);
    const [ev] = await auditFor(id, 'search_profile.reprocess_failed');
    assert.equal(ev!.outcome, 'failure');
  } finally {
    failEnqueue = false;
  }
});

test('listagem: paginação por cursor sem repetir nem pular, filtro por active e cursor inválido', async () => {
  const names = ['pg-1', 'pg-2', 'pg-3'];
  for (const name of names) await newProfile({ name, includeTerms: ['lgpd'], active: false });
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r: { status: number; body: any } = await json(h.listProfiles(req('GET', undefined, `?active=false&limit=2${cursor ? `&cursor=${cursor}` : ''}`), ctx(A)));
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length <= 2);
    assert.ok(r.body.items.every((p: { active: boolean }) => p.active === false));
    seen.push(...r.body.items.map((p: { name: string }) => p.name));
    cursor = r.body.nextCursor;
    pages += 1;
  } while (cursor && pages < 20);
  assert.equal(new Set(seen).size, seen.length, 'sem repetição entre páginas');
  for (const n of names) assert.ok(seen.includes(n), `faltou ${n}`);
  assert.ok(pages >= 2);
  await assert.rejects(h.listProfiles(req('GET', undefined, '?cursor=abc'), ctx(A)), status(422));
});

/* ---------------------------- CompanyCapability --------------------------- */

const newCap = async (body: Record<string, unknown>, companyId = A) => {
  const r = await json(h.createCapability(req('POST', body), ctx(companyId)));
  if (r.status === 201) created.capabilities.push(r.body.id);
  return r;
};

test('capacidade: cria, lê, lista e altera; audita sem vazar conteúdo', async () => {
  const r = await newCap({ kind: 'certification', subject: 'professional', name: 'EXIN PDPF', keywords: ['lgpd', 'privacidade'], validUntil: '2028-01-31', evidenceDocumentId: evidenceDoc });
  assert.equal(r.status, 201);
  assert.equal(r.body.companyId, A);
  assert.equal(r.body.active, true);
  assert.equal(r.body.evidenceDocumentId, evidenceDoc);
  const id = r.body.id as string;
  assert.deepEqual((await auditFor(id, 'capability.created'))[0]!.metadata, { kind: 'certification', subject: 'professional', active: true });

  assert.equal((await json(h.getCapability(req('GET'), item(id)))).body.name, 'EXIN PDPF');
  const upd = await json(h.patchCapability(req('PATCH', { active: false, keywords: ['lgpd'] }), item(id)));
  assert.equal(upd.status, 200);
  assert.equal(upd.body.active, false);
  assert.deepEqual(upd.body.keywords, ['lgpd']);
  assert.deepEqual((await auditFor(id, 'capability.updated'))[0]!.metadata, { fields: ['keywords', 'active'].sort((a, b) => (Object.keys(upd.body).indexOf(a) - Object.keys(upd.body).indexOf(b))), active: false });
  const list = await json(h.listCapabilities(req('GET', undefined, '?active=false'), ctx(A)));
  assert.ok(list.body.items.some((c: { id: string }) => c.id === id));
});

test('capacidade: regras do contrato valem também no PATCH (merge com o estado gravado)', async () => {
  const fin = { referenceDate: '2025-12-31', currentLiquidity: '1.5', generalLiquidity: '1.2', generalSolvency: null, netWorth: '250000' };
  const r = await newCap({ kind: 'financial_capacity', name: 'Balanço 2025', financialIndicators: fin });
  assert.equal(r.status, 201);
  assert.equal(r.body.financialIndicators.currentLiquidity, '1.5');
  const id = r.body.id as string;
  await assert.rejects(h.patchCapability(req('PATCH', { kind: 'product' }), item(id)), status(422), 'financialIndicators só vale para financial_capacity');

  const prod = await newCap({ kind: 'product', name: 'Notebooks' });
  await assert.rejects(h.patchCapability(req('PATCH', { subject: 'professional' }), item(prod.body.id)), status(422));
});

test('capacidade: documento de evidência precisa ser da própria empresa', async () => {
  await assert.rejects(h.createCapability(req('POST', { kind: 'license', name: 'Licença', evidenceDocumentId: otherDoc }), ctx(A)), status(422), 'documento de B em A');
  await assert.rejects(h.createCapability(req('POST', { kind: 'license', name: 'Licença', evidenceDocumentId: '99999999-9999-4999-8999-999999999999' }), ctx(A)), status(422));
  const ok = await newCap({ kind: 'license', name: 'Licença' });
  await assert.rejects(h.patchCapability(req('PATCH', { evidenceDocumentId: otherDoc }), item(ok.body.id)), status(422));
});

test('capacidade: isolamento entre empresas e PATCH sem mudança não grava', async () => {
  const b = await newCap({ kind: 'service', name: 'Serviço de B' }, B);
  assert.equal(b.status, 201);
  await assert.rejects(h.getCapability(req('GET'), item(b.body.id, A)), status(404));
  await assert.rejects(h.patchCapability(req('PATCH', { name: 'invadida' }), item(b.body.id, A)), status(404));
  assert.ok((await json(h.listCapabilities(req('GET'), ctx(A)))).body.items.every((c: { companyId: string }) => c.companyId === A));

  const [before] = await db.select({ u: s.companyCapabilities.updatedAt }).from(s.companyCapabilities).where(eq(s.companyCapabilities.id, b.body.id));
  const same = await json(h.patchCapability(req('PATCH', { name: 'Serviço de B' }), item(b.body.id, B)));
  assert.equal(same.status, 200);
  const [after] = await db.select({ u: s.companyCapabilities.updatedAt }).from(s.companyCapabilities).where(eq(s.companyCapabilities.id, b.body.id));
  assert.equal(after!.u.getTime(), before!.u.getTime());
});
