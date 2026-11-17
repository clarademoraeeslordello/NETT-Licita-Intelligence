/**
 * T-203 — integração com Postgres real (banco descartável migrado + schema pgboss) e armazenamento em memória.
 *   DATABASE_URL_TEST (nett_app) e DATABASE_URL_MIGRATOR (instala pgboss)
 *   npm run test:documents:integration   (script a cargo do agente 01; até lá: npx tsx --test <este arquivo>)
 * O download é simulado (fetch/lookup injetados): sem rede.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import * as s from '../../db/schema';
import { createBoss } from '../../jobs/boss';
import { stableKey } from '../../jobs/enqueue';
import { setupJobs } from '../../jobs/setup';
import { assertValidKey, sha256Hex, type ObjectStorage } from '../../storage';
import type { DownloadDeps } from './download';
import { fetchDocument } from './fetch';

const appUrl = process.env.DATABASE_URL_TEST;
const migratorUrl = process.env.DATABASE_URL_MIGRATOR;
if (!appUrl || !migratorUrl) throw new Error('DATABASE_URL_TEST e DATABASE_URL_MIGRATOR são obrigatórias');

const run = Date.now().toString(36);
const PDF = new TextEncoder().encode(`%PDF-1.7\n% edital de teste ${run}\n`);
const URL_OK = 'https://pncp.gov.br/pncp-api/v1/orgaos/12345678000190/compras/2026/1/arquivos/';

let pool: Pool;
let boss: PgBoss;
let sourceId: string;
let opportunityId: string;
const criados: string[] = [];
const db = () => drizzle(pool, { schema: s, casing: 'snake_case' });

class MemoryStorage implements ObjectStorage {
  objetos = new Map<string, { body: Uint8Array; contentType: string }>();
  async put(key: string, body: Uint8Array, contentType: string) {
    assertValidKey(key);
    this.objetos.set(key, { body, contentType });
    return { sha256: sha256Hex(body), sizeBytes: body.byteLength };
  }
  async get(key: string) {
    return this.objetos.get(key)!.body;
  }
  async signedUrl(key: string) {
    return `memory://${key}`;
  }
}

const resposta = (status: number, body: Uint8Array | null = PDF): DownloadDeps => ({
  fetch: (async () => new Response(status === 204 ? null : ((body ?? null) as BodyInit | null), { status })) as typeof fetch,
  lookup: async () => ['200.100.50.25'],
  throttle: async () => {},
});

async function novoDocumento(patch: Partial<typeof s.documents.$inferInsert> = {}, sufixo = Math.random().toString(36).slice(2)) {
  const [d] = await db()
    .insert(s.documents)
    .values({ opportunityId, companyId: null, kind: 'tender_notice', origin: 'source', title: 'edital.pdf', sourceUrl: `${URL_OK}${sufixo}`, mimeType: 'application/pdf', ...patch })
    .returning();
  criados.push(d!.id);
  return d!;
}
const recarregar = async (id: string) => (await db().select().from(s.documents).where(eq(s.documents.id, id)))[0]!;

before(async () => {
  await setupJobs(migratorUrl);
  pool = new Pool({ connectionString: appUrl, max: 4 });
  boss = createBoss(appUrl);
  await boss.start();
  const [src] = await db().insert(s.sources).values({ key: `docs_t${run}`.slice(0, 40), name: 'Fonte de teste', kind: 'api', baseUrl: null, rateLimit: { requestsPerMinute: 60, maxConcurrency: 1 }, config: {} }).returning({ id: s.sources.id });
  sourceId = src!.id;
  const [opp] = await db()
    .insert(s.opportunities)
    .values({
      canonicalKey: `docs_t${run}:oportunidade-1`,
      primarySourceId: sourceId,
      title: 'Edital de teste',
      objectDescription: 'Objeto de teste do document.fetch',
      agencyName: 'Órgão de teste',
      sphere: 'federal',
      status: 'published',
      url: 'https://pncp.gov.br/app/editais/1/2026/1',
      contentHash: 'a'.repeat(64),
    })
    .returning({ id: s.opportunities.id });
  opportunityId = opp!.id;
});

after(async () => {
  for (const q of ['document.fetch', 'document.extract'] as const) await boss.deleteQueuedJobs(q);
  if (criados.length) await db().delete(s.documents).where(inArray(s.documents.id, criados));
  await db().delete(s.opportunities).where(eq(s.opportunities.id, opportunityId));
  await db().delete(s.sources).where(eq(s.sources.id, sourceId));
  await boss.stop({ graceful: false });
  await pool.end();
});

test('guarda o arquivo no storage com chave pelo hash, atualiza só os campos do agente 02 e enfileira document.extract', async () => {
  const storage = new MemoryStorage();
  const doc = await novoDocumento({ title: 'edital.pdf' });
  const r = await fetchDocument({ pool, boss, storage, download: resposta(200) }, doc.id);
  const sha = sha256Hex(PDF);
  assert.deepEqual(r, { status: 'stored', storageKey: `public/${opportunityId}/${sha}.pdf`, sizeBytes: PDF.byteLength, mimeType: 'application/pdf' });
  assert.equal(storage.objetos.get(`public/${opportunityId}/${sha}.pdf`)?.contentType, 'application/pdf');
  assert.deepEqual(storage.objetos.get(`public/${opportunityId}/${sha}.pdf`)?.body, PDF);

  const d = await recarregar(doc.id);
  assert.equal(d.storageKey, `public/${opportunityId}/${sha}.pdf`);
  assert.equal(d.sha256, sha);
  assert.equal(d.sizeBytes, PDF.byteLength);
  assert.ok(d.fetchedAt);
  assert.equal(d.textStatus, 'pending'); // campo do agente 03: intocado
  assert.equal(d.companyId, null);

  const extrair = await boss.findJobs<{ documentId: string }>('document.extract', { key: stableKey({ documentId: doc.id }), queued: true });
  assert.equal(extrair.length, 1);
});

test('idempotente: documento já baixado não é baixado de novo', async () => {
  const doc = await novoDocumento();
  const storage = new MemoryStorage();
  await fetchDocument({ pool, boss, storage, download: resposta(200) }, doc.id);
  let chamadas = 0;
  const contador: DownloadDeps = { ...resposta(200), fetch: (async () => void (chamadas += 1)) as unknown as typeof fetch };
  assert.deepEqual(await fetchDocument({ pool, boss, storage, download: contador }, doc.id), { status: 'already_done' });
  assert.equal(chamadas, 0);
});

test('mesmos bytes em dois documentos da oportunidade: o segundo é registrado sem repetir a chave única', async () => {
  const storage = new MemoryStorage();
  const a = await novoDocumento({ title: 'a.pdf' }, 'dup-a');
  const b = await novoDocumento({ title: 'b.pdf' }, 'dup-b');
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% duplicado ${run}\n`);
  const dl = resposta(200, bytes);
  const ra = await fetchDocument({ pool, boss, storage, download: dl }, a.id);
  const rb = await fetchDocument({ pool, boss, storage, download: dl }, b.id);
  assert.equal(ra.status, 'stored');
  assert.deepEqual({ status: rb.status, storageKey: rb.status === 'stored' ? rb.storageKey : 'x', duplicateOf: rb.status === 'stored' ? rb.duplicateOf : 'x' }, { status: 'stored', storageKey: null, duplicateOf: a.id });
  const db_ = await recarregar(b.id);
  assert.equal(db_.storageKey, null);
  assert.equal(db_.sha256, sha256Hex(bytes));
  assert.ok(db_.fetchedAt);
});

test('rejeições definitivas não lançam, não gravam arquivo e deixam AuditEvent sem a URL completa', async () => {
  const storage = new MemoryStorage();
  const casos: Array<{ nome: string; patch: Partial<typeof s.documents.$inferInsert>; dl: DownloadDeps; motivo: string }> = [
    { nome: 'url fora do PNCP', patch: { sourceUrl: 'https://evil.test/x.pdf?token=segredo' }, dl: resposta(200), motivo: 'url_not_allowed' },
    { nome: 'metadados de nuvem', patch: { sourceUrl: 'https://169.254.169.254/latest/meta-data' }, dl: resposta(200), motivo: 'url_not_allowed' },
    { nome: 'host resolve para rede interna', patch: {}, dl: { ...resposta(200), lookup: async () => ['10.0.0.7'] }, motivo: 'private_address' },
    { nome: 'conteúdo HTML de erro', patch: {}, dl: resposta(200, new TextEncoder().encode('<!DOCTYPE html><html>x</html>')), motivo: 'mime_not_allowed' },
    { nome: 'grande demais', patch: {}, dl: { ...resposta(200, new Uint8Array(4096).fill(0x25)), maxBytes: 1024 }, motivo: 'too_large' },
    { nome: 'não encontrado', patch: {}, dl: resposta(404, null), motivo: 'not_found' },
  ];
  for (const c of casos) {
    const doc = await novoDocumento(c.patch);
    const r = await fetchDocument({ pool, boss, storage, download: c.dl }, doc.id);
    assert.deepEqual(r, { status: 'rejected', reason: c.motivo }, c.nome);
    const d = await recarregar(doc.id);
    assert.equal(d.storageKey, null, c.nome);
    assert.equal(d.fetchedAt, null, c.nome);
    const [ev] = await db().select().from(s.auditEvents).where(eq(s.auditEvents.entityId, doc.id));
    assert.equal(ev?.action, 'document.fetch_rejected', c.nome);
    assert.equal(ev?.outcome, 'failure', c.nome);
    assert.doesNotMatch(JSON.stringify(ev?.metadata), /segredo|token|meta-data/, `${c.nome}: a URL completa não vai para a auditoria`);
  }
  assert.equal(storage.objetos.size, 0, 'nada gravado no storage');
});

test('falha passageira (5xx) lança para o pg-boss retentar; 429 reenfileira o mesmo job após o cooldown sem retentar', async () => {
  const storage = new MemoryStorage();
  const doc = await novoDocumento();
  await assert.rejects(fetchDocument({ pool, boss, storage, download: resposta(503, null) }, doc.id));
  assert.equal((await recarregar(doc.id)).fetchedAt, null);

  let chamadas = 0;
  const limitado: DownloadDeps = { ...resposta(429, null), fetch: (async () => (chamadas += 1, new Response(null, { status: 429 }))) as unknown as typeof fetch };
  const r = await fetchDocument({ pool, boss, storage, download: limitado }, doc.id);
  assert.equal(r.status, 'rate_limited');
  assert.equal(chamadas, 1);
  const futuros = await boss.findJobs<{ documentId: string }>('document.fetch', { key: stableKey({ documentId: doc.id }), queued: true });
  assert.equal(futuros.length, 1);
  assert.ok(futuros[0]!.startAfter.getTime() > Date.now() + 60_000, 'só roda depois do cooldown');
});

test('não se aplica a documento privado, sem origem de fonte ou inexistente', async () => {
  const storage = new MemoryStorage();
  assert.deepEqual(await fetchDocument({ pool, boss, storage, download: resposta(200) }, '00000000-0000-4000-8000-000000000000'), { status: 'missing' });
  const semUrl = await novoDocumento({ sourceUrl: null });
  assert.deepEqual(await fetchDocument({ pool, boss, storage, download: resposta(200) }, semUrl.id), { status: 'not_applicable' });
  const upload = await novoDocumento({ origin: 'upload' });
  assert.deepEqual(await fetchDocument({ pool, boss, storage, download: resposta(200) }, upload.id), { status: 'not_applicable' });
  assert.equal(storage.objetos.size, 0);
});
