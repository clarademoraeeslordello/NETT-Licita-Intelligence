/**
 * T-217 com Postgres (DATABASE_URL_TEST, papel nett_app, banco migrado). Não se chama *.test.ts de propósito:
 * os testes sem banco não devem pegá-lo.
 * Rodar: npx tsx --test src/server/matching/radar/radar.integration.ts
 *
 * Passa pelo handler com a autorização REAL (`authorizeCompany` sobre memberships). Tudo que cria é removido em `after`,
 * exceto os 2 usuários (a negação de acesso gera `audit_events`, somente inclusão, que os referencia).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { authorizeCompany } from '../../auth/guard';
import type { Session } from '../../auth/session';
import type { Db } from '../../db';
import * as s from '../../db/schema';
import { HttpError } from '../../http/errors';
import { buildSearchText, upsertSearchText } from '../../sources/read/search-index';
import { radarHandlers } from './handlers';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST não configurada');
const pool = new Pool({ connectionString: url, max: 4 });
const db = drizzle(pool, { schema: s, casing: 'snake_case' }) as unknown as Db;
const run = Date.now().toString().slice(-9);
const hash = 'f'.repeat(64);
const DAY = 86_400_000;
const NOW = new Date();

let A: string, B: string, viewer: string, outsider: string, src: string;
let P1: string, P2: string, P3: string, PB: string;
const o: Record<string, string> = {};

const session = (userId: string) => ({ user: { id: userId }, realmRoles: [] }) as unknown as Session;
let current = () => session(viewer);
const h = radarHandlers({ db: () => db, requireSession: async () => current(), authorize: (sess, cid, role) => authorizeCompany(db, sess, cid, role), now: () => NOW });
const ctx = (companyId = A) => ({ params: Promise.resolve({ companyId }) });
const get = async (query = '', companyId = A) => {
  const r = await h.GET(new Request(`http://localhost/radar${query}`), ctx(companyId));
  return { status: r.status, body: (await r.json()) as any };
};
const status = (code: number) => (e: unknown) => e instanceof HttpError && e.status === code;
const ids = (body: any) => body.items.map((i: any) => i.opportunity.id as string);
/** Ordem do radar: nota desc, id asc. */
const order = (rows: { id: string; score: number }[]) => [...rows].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).map((r) => r.id);

async function opportunity(key: string, over: Partial<typeof s.opportunities.$inferInsert> = {}) {
  const [row] = await db
    .insert(s.opportunities)
    .values({
      canonicalKey: `pncp:rd${run}-${key}`,
      primarySourceId: src,
      title: `Pregão ${key}`,
      objectDescription: 'Objeto genérico',
      agencyName: 'Prefeitura Fictícia',
      sphere: 'municipal',
      status: 'receiving_proposals',
      uf: 'RN',
      modalityCode: 6,
      proposalsCloseAt: new Date(NOW.getTime() + 10 * DAY),
      url: 'https://pncp.gov.br/x',
      contentHash: hash,
      ...over,
    })
    .returning({ id: s.opportunities.id });
  o[key] = row!.id;
  return row!.id;
}
const score = (oppKey: string, profileId: string, companyId: string, value: number, primaryCategory: (typeof s.matchScores.$inferInsert)['primaryCategory'] = null) =>
  db.insert(s.matchScores).values({ opportunityId: o[oppKey]!, companyId, searchProfileId: profileId, score: value, factors: [], caps: [], algorithmVersion: 'v1', opportunityContentHash: hash, primaryCategory });

before(async () => {
  [{ id: A }, { id: B }] = (await db
    .insert(s.companies)
    .values([
      { legalName: 'Empresa A', cnpj: `61${run}0001`.slice(0, 14).padEnd(14, '0'), size: 'EPP' },
      { legalName: 'Empresa B', cnpj: `62${run}0002`.slice(0, 14).padEnd(14, '0'), size: 'ME' },
    ])
    .returning({ id: s.companies.id })) as [{ id: string }, { id: string }];
  [{ id: viewer }, { id: outsider }] = (await db
    .insert(s.userAccounts)
    .values(['leitor', 'externo'].map((n) => ({ keycloakSub: `rd-${n}-${run}`, email: `${n}@exemplo.test`, name: n })))
    .returning({ id: s.userAccounts.id })) as [{ id: string }, { id: string }];
  await db.insert(s.memberships).values({ userId: viewer, companyId: A, role: 'viewer' });
  [{ id: src }] = await db.insert(s.sources).values({ key: `rd_${run}`, name: 'PNCP', kind: 'api', rateLimit: { requestsPerMinute: 30, maxConcurrency: 3 } }).returning({ id: s.sources.id });

  const profile = async (companyId: string, name: string, minScore: number, active: boolean) =>
    (await db.insert(s.searchProfiles).values({ companyId, name, includeTerms: ['x'], minScore, active, ownerUserId: viewer }).returning({ id: s.searchProfiles.id }))[0]!.id;
  P1 = await profile(A, 'Perfil 1', 50, true);
  P2 = await profile(A, 'Perfil 2', 0, true);
  P3 = await profile(A, 'Perfil inativo', 0, false);
  PB = await profile(B, 'Perfil B', 0, true);

  await opportunity('o1', { title: 'Consultoria LGPD Natal' });
  await opportunity('o2', { uf: 'PB', modalityCode: 8, title: 'Auditoria ISO 27001' });
  await opportunity('o3');
  await opportunity('o4'); // só com nota abaixo do minScore do perfil
  await opportunity('o5'); // só perfil inativo
  await opportunity('o6', { status: 'published', proposalsCloseAt: new Date(NOW.getTime() - DAY) }); // situação efetiva: closed
  await opportunity('o7', { uf: null, modalityCode: null, title: 'Software de gestão', objectDescription: 'Sistema de gestão pública', proposalsCloseAt: new Date(NOW.getTime() + 40 * DAY) });
  await opportunity('o8'); // só da empresa B
  await opportunity('o9', { proposalsCloseAt: null, status: 'published' }); // published sem prazo: situação efetiva "published"
  await opportunity('o10', { uf: 'RN', title: 'Licença de BI' });

  await score('o1', P1, A, 80, 'lgpd');
  await score('o1', P2, A, 92, 'lgpd'); // a melhor nota é a do Perfil 2
  await score('o2', P1, A, 80, 'audit_iso');
  await score('o3', P1, A, 80, 'security_infra'); // empata com o2: desempate por id
  await score('o4', P1, A, 40); // < minScore 50 do Perfil 1
  await score('o5', P3, A, 99); // perfil inativo
  await score('o6', P1, A, 70, 'software');
  await score('o7', P1, A, 60, 'software');
  await score('o8', PB, B, 99, 'lgpd');
  await score('o9', P1, A, 55);
  await score('o9', P2, A, 30);
  await score('o10', P2, A, 60, 'data_bi_ai');
  for (const key of ['o1', 'o7', 'o10']) {
    const [r] = await db.select().from(s.opportunities).where(eq(s.opportunities.id, o[key]!));
    await upsertSearchText(db, r!.id, buildSearchText(r!));
  }
});

after(async () => {
  try {
    const oppIds = Object.values(o);
    if (oppIds.length) {
      await db.delete(s.opportunitySearch).where(inArray(s.opportunitySearch.opportunityId, oppIds));
      await db.delete(s.opportunities).where(inArray(s.opportunities.id, oppIds)); // notas em cascata
    }
    if (A) await db.delete(s.companies).where(inArray(s.companies.id, [A, B])); // perfis e vínculos em cascata
    // Os usuários ficam: `authorizeCompany` grava `authz.denied` em `audit_events` (somente inclusão) com FK para eles.
    if (src) await db.delete(s.sources).where(eq(s.sources.id, src));
  } finally {
    await pool.end();
  }
});

/** Linhas esperadas no radar de A com os filtros padrão (abertas, perfis ativos, nota >= minScore do perfil). */
const baseline = () =>
  order([
    { id: o.o1!, score: 92 },
    { id: o.o2!, score: 80 },
    { id: o.o3!, score: 80 },
    { id: o.o7!, score: 60 },
    { id: o.o10!, score: 60 },
    { id: o.o9!, score: 55 },
  ]);

test('autorização: viewer lê; quem não é da empresa e outra empresa recebem 403', async () => {
  assert.equal((await get()).status, 200);
  current = () => session(outsider);
  await assert.rejects(h.GET(new Request('http://localhost/radar'), ctx(A)), status(403));
  current = () => session(viewer);
  await assert.rejects(h.GET(new Request('http://localhost/radar'), ctx(B)), status(403), 'viewer de A não tem vínculo com B');
});

test('radar padrão: abertas, uma linha por oportunidade, por nota e id; nada de outra empresa nem de perfil inativo', async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r.body), baseline());
  assert.equal(r.body.nextCursor, null);
  for (const gone of ['o4', 'o5', 'o6', 'o8']) assert.ok(!ids(r.body).includes(o[gone]), `${gone} não deveria aparecer`);
  const first = r.body.items[0];
  assert.equal(first.match.score, 92);
  assert.equal(first.match.band, 'high');
  assert.equal(first.match.searchProfileName, 'Perfil 2', 'a nota mostrada é a do melhor perfil');
  assert.equal(first.match.searchProfileId, P2);
  assert.equal(first.match.primaryCategory, 'lgpd');
  assert.equal(first.opportunity.effectiveStatus, 'receiving_proposals');
  assert.equal(first.opportunity.sourceKey, `rd_${run}`);
});

test('o minScore de cada perfil vale: nota abaixo do mínimo do perfil não entra, mesmo que outro perfil a aceite', async () => {
  const r = await get();
  const o9 = r.body.items.find((i: any) => i.opportunity.id === o.o9);
  assert.equal(o9.match.score, 55);
  assert.equal(o9.match.searchProfileName, 'Perfil 1');
  assert.ok(!ids(r.body).includes(o.o4!), 'o4 só tem nota 40 num perfil que exige 50');
  // Subindo o minScore do Perfil 1 para 60, o9 (55) só sobra pelo Perfil 2 com 30.
  await db.update(s.searchProfiles).set({ minScore: 60 }).where(eq(s.searchProfiles.id, P1));
  try {
    const r2 = await get();
    const again = r2.body.items.find((i: any) => i.opportunity.id === o.o9);
    assert.equal(again.match.score, 30);
    assert.equal(again.match.searchProfileName, 'Perfil 2');
  } finally {
    await db.update(s.searchProfiles).set({ minScore: 50 }).where(eq(s.searchProfiles.id, P1));
  }
});

test('nota mínima da consulta é adicional', async () => {
  assert.deepEqual(ids((await get('?minScore=80')).body), order([{ id: o.o1!, score: 92 }, { id: o.o2!, score: 80 }, { id: o.o3!, score: 80 }]));
  assert.deepEqual(ids((await get('?minScore=100')).body), []);
});

test('perfil inativo sai do radar; reativado, volta; o melhor perfil inativo cede a vez ao outro', async () => {
  await db.update(s.searchProfiles).set({ active: true }).where(eq(s.searchProfiles.id, P3));
  try {
    assert.equal((await get()).body.items[0].opportunity.id, o.o5, 'perfil reativado: o5 (99) lidera');
  } finally {
    await db.update(s.searchProfiles).set({ active: false }).where(eq(s.searchProfiles.id, P3));
  }
  await db.update(s.searchProfiles).set({ active: false }).where(eq(s.searchProfiles.id, P2));
  try {
    const r = await get();
    const o1 = r.body.items.find((i: any) => i.opportunity.id === o.o1);
    assert.equal(o1.match.score, 80, 'sem o Perfil 2, vale a nota do Perfil 1');
    assert.ok(!ids(r.body).includes(o.o10!), 'o10 só tinha o Perfil 2');
  } finally {
    await db.update(s.searchProfiles).set({ active: true }).where(eq(s.searchProfiles.id, P2));
  }
  assert.deepEqual(ids((await get()).body), baseline());
});

test('empate de nota entre perfis: vale o perfil de menor id (determinístico)', async () => {
  await score('o3', P2, A, 80, 'security_infra'); // o3 já tinha 80 no Perfil 1
  try {
    const r = await get();
    const item = r.body.items.find((i: any) => i.opportunity.id === o.o3);
    assert.equal(item.match.score, 80);
    assert.equal(item.match.searchProfileId, [P1, P2].sort()[0]);
    assert.equal(ids(r.body).filter((x: string) => x === o.o3).length, 1, 'continua uma linha por oportunidade');
  } finally {
    await db.delete(s.matchScores).where(and(eq(s.matchScores.searchProfileId, P2), eq(s.matchScores.opportunityId, o.o3!)));
  }
});

test('paginação por cursor: sem repetir nem pular, e com a ordem do radar', async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r: { status: number; body: any } = await get(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length <= 2);
    seen.push(...ids(r.body));
    cursor = r.body.nextCursor;
    pages += 1;
  } while (cursor && pages < 10);
  assert.deepEqual(seen, baseline());
  assert.equal(pages, 3);
});

test('filtros: uf, modalidade, categoria, perfil e situação efetiva', async () => {
  assert.deepEqual(ids((await get('?ufs=PB')).body), [o.o2]);
  assert.deepEqual(ids((await get('?modalities=8')).body), [o.o2]);
  assert.deepEqual(new Set(ids((await get('?ufs=RN')).body)), new Set([o.o1, o.o3, o.o10, o.o9]), 'sem UF (o7) fica fora de um filtro por UF');
  assert.deepEqual(ids((await get('?category=lgpd')).body), [o.o1]);
  assert.deepEqual(new Set(ids((await get('?category=lgpd,audit_iso')).body)), new Set([o.o1, o.o2]));
  assert.deepEqual(ids((await get(`?profileId=${P1}`)).body), order([{ id: o.o1!, score: 80 }, { id: o.o2!, score: 80 }, { id: o.o3!, score: 80 }, { id: o.o7!, score: 60 }, { id: o.o9!, score: 55 }]));
  assert.deepEqual(ids((await get(`?profileId=${PB}`)).body), [], 'perfil de outra empresa não devolve nada');
  // situação efetiva: o6 (published com prazo vencido) é "closed"; o9 (published sem prazo) é "published"
  assert.deepEqual(ids((await get('?status=closed')).body), [o.o6]);
  assert.deepEqual(ids((await get('?status=published')).body), [o.o9]);
  assert.deepEqual(new Set(ids((await get('?status=closed,published,receiving_proposals')).body)), new Set([...baseline(), o.o6]));
});

test('filtros: janela de prazo (data pura = dia inteiro em São Paulo) e busca textual', async () => {
  const day = (offset: number) => new Date(NOW.getTime() + offset * DAY).toISOString().slice(0, 10);
  assert.deepEqual(ids((await get(`?closesFrom=${day(30)}`)).body), [o.o7], 'só o7 fecha daqui a 40 dias');
  assert.deepEqual(new Set(ids((await get(`?closesTo=${day(20)}`)).body)), new Set([o.o1, o.o2, o.o3, o.o10]), 'sem prazo (o9) fica fora de uma janela');
  assert.deepEqual(ids((await get('?q=lgpd natal')).body), [o.o1]);
  assert.deepEqual(ids((await get('?q=Gestão')).body), [o.o7], 'sem acento e sem caixa');
  assert.deepEqual(ids((await get('?q=inexistente')).body), []);
  assert.deepEqual(ids((await get('?q=software&ufs=RN')).body), [], 'filtros se combinam (e)');
});

test('parâmetros e cursor inválidos → 400 sem erro de servidor', async () => {
  for (const bad of ['?limit=0', '?limit=101', '?ufs=XX', '?minScore=101', '?minScore=-1', '?category=outra', '?status=nada', '?q=ab', '?profileId=x', '?sort=score', '?closesFrom=ontem', '?cursor=%%%']) {
    await assert.rejects(h.GET(new Request(`http://localhost/radar${bad}`), ctx(A)), status(400), bad);
  }
  const cur = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const id = o.o1!;
  for (const c of [
    cur({ v: 1, s: 'published_desc', k: '80', id }), // outra ordenação
    cur({ v: 1, s: 'score_desc', k: '101', id }),
    cur({ v: 1, s: 'score_desc', k: 'abc', id }),
    cur({ v: 1, s: 'score_desc', k: null, id }),
    cur({ v: 1, s: 'score_desc', k: '80', id: "x'; drop table opportunities; --" }),
  ])
    await assert.rejects(h.GET(new Request(`http://localhost/radar?cursor=${c}`), ctx(A)), status(400));
});
