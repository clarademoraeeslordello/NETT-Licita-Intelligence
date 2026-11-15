/**
 * T-201 — consulta REAL à API pública do PNCP (requer rede). Volume mínimo: 1 página + 1 enriquecimento.
 *   npm run test:sources:live
 */
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { PncpConnector, PAGE_SIZE } from './connector';

const connector = new PncpConnector({ modalities: [6], since: new Date('2026-11-12T15:00:00Z'), until: new Date('2026-11-12T15:00:00Z') });
let page: Awaited<ReturnType<PncpConnector['fetchPage']>>;

before(async () => {
  page = await connector.fetchPage(null);
});

test('listagem real (/consulta): página cheia, cursor avança e registros normalizam', () => {
  assert.equal(page.records.length, PAGE_SIZE);
  assert.ok(page.totalPages > 1);
  assert.deepEqual(page.nextCursor, { ...connector.initialCursor(), page: 2 });
  for (const r of page.records) assert.match(r.externalId, /^\d{14}-\d+-\d{6}\/\d{4}$/);
  const resultados = page.records.map((r) => connector.normalize(r.payload));
  const descartes = resultados.filter((r) => 'skip' in r);
  assert.ok(descartes.length <= 2, `descartes: ${descartes.map((r) => ('skip' in r ? r.skip : '')).join('; ')}`);
});

test('enriquecimento real (/pncp/v1 itens + arquivos) e normalização completa', { timeout: 180_000 }, async () => {
  const enriquecido = await connector.enrich(page.records[0]!.payload);
  assert.ok(Array.isArray(enriquecido.itens) && enriquecido.itens.length > 0);
  const r = connector.normalize(enriquecido);
  assert.ok(!('skip' in r));
  if ('skip' in r) return;
  assert.equal(r.items.length, enriquecido.itens!.length);
  for (const d of r.documents) assert.match(d.sourceUrl, /^https:\/\/pncp\.gov\.br\//);
});
