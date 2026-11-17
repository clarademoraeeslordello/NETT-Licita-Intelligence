/**
 * T-201 — unidade (sem rede). Amostras REAIS do PNCP capturadas em 13/11/2026 em __fixtures__.
 *   npm run test:sources
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixtures from './__fixtures__/compras-reais.json';
import { opportunity } from '@/contracts/sources';
import './proposals.test'; // T-213 (propostas abertas): mesma execução de test:sources
import { PncpConnector, pncpCursor } from './connector';
import { normalizePncp, toDecimal, urlDocumentoPermitida } from './normalize';

const ok = (r: ReturnType<typeof normalizePncp>) => {
  if ('skip' in r) throw new Error(r.skip);
  return r;
};

test('normaliza compras reais no formato canônico', () => {
  for (const f of fixtures) {
    const r = ok(normalizePncp(f));
    const c = f.compra;
    const [cnpj, , seq6, ano] = c.numeroControlePNCP.split(/[-/]/);
    assert.equal(r.opportunity.canonicalKey, `pncp:${cnpj}-${ano}-${Number(seq6)}`);
    assert.equal(r.opportunity.agencyCnpj, cnpj);
    assert.equal(r.opportunity.modalityCode, 6);
    assert.equal(r.opportunity.modalityName, 'Pregão eletrônico');
    assert.equal(r.opportunity.status, 'published');
    assert.equal(r.opportunity.url, `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${Number(seq6)}`);
    assert.match(r.opportunity.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(r.items.length, f.itens.length);
    assert.equal(r.documents.length, f.arquivos.filter((a) => a.statusAtivo !== false).length);
    // Valida contra o schema canônico completo, preenchendo só os campos do pipeline de persistência.
    const agora = new Date().toISOString();
    opportunity.parse({ ...r.opportunity, id: crypto.randomUUID(), primarySourceId: crypto.randomUUID(), firstSeenAt: agora, lastSeenAt: agora, createdAt: agora, updatedAt: agora });
  }
});

test('mapeia SRP, valores decimais, benefício ME/EPP e tipo de documento', () => {
  const srp = ok(normalizePncp(fixtures[0]));
  assert.equal(srp.opportunity.priceRegistration, true);
  assert.equal(srp.opportunity.estimatedValue, '6000000');
  assert.equal(srp.opportunity.meEppBenefit, 'none');
  assert.equal(srp.documents[0]!.kind, 'tender_notice');
  assert.equal(srp.documents[0]!.mimeType, 'application/pdf');
  const outra = ok(normalizePncp(fixtures[1]));
  assert.equal(outra.opportunity.estimatedValue, '894136.41');
  assert.deepEqual(outra.documents.map((d) => d.kind), ['tender_notice', 'tender_notice', 'reference_term']);
});

test('é pura e estável; mudança relevante altera o contentHash', () => {
  const a = ok(normalizePncp(fixtures[0]));
  const b = ok(normalizePncp(structuredClone(fixtures[0])));
  assert.deepEqual(a, b);
  const alterada = structuredClone(fixtures[0]);
  alterada.compra.dataEncerramentoProposta = '2026-12-30T09:00:00';
  assert.notEqual(ok(normalizePncp(alterada)).opportunity.contentHash, a.opportunity.contentHash);
});

test('situação, sigilo e itens ausentes', () => {
  const base = structuredClone(fixtures[0]);
  const com = (patch: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ok(normalizePncp({ ...base, ...extra, compra: { ...base.compra, ...patch } }));
  assert.equal(com({ situacaoCompraId: 2 }).opportunity.status, 'cancelled');
  assert.equal(com({ situacaoCompraId: 4 }).opportunity.status, 'suspended');
  assert.equal(com({ valorTotalHomologado: 10 }).opportunity.status, 'awarded');
  const sigilo = com({ orcamentoSigilosoCodigo: 2 });
  assert.equal(sigilo.opportunity.confidentialBudget, true);
  assert.equal(sigilo.opportunity.estimatedValue, null);
  const semItens = com({}, { itens: null, arquivos: null });
  assert.equal(semItens.opportunity.meEppBenefit, 'unknown');
  assert.deepEqual(semItens.items, []);
});

test('rejeita payload inválido com skip e documento fora do PNCP', () => {
  assert.ok('skip' in normalizePncp({ compra: { objetoCompra: 'x' } }));
  assert.ok('skip' in normalizePncp({ compra: { ...fixtures[0].compra, objetoCompra: '   ' } }));
  assert.equal(urlDocumentoPermitida('https://pncp.gov.br/pncp-api/v1/x'), true);
  assert.equal(urlDocumentoPermitida('http://pncp.gov.br/x'), false);
  assert.equal(urlDocumentoPermitida('https://pncp.gov.br.evil.test/x'), false);
  assert.equal(urlDocumentoPermitida('https://169.254.169.254/latest'), false);
  const r = ok(normalizePncp({ ...fixtures[0], arquivos: [{ ...fixtures[0].arquivos[0], url: 'https://exemplo.test/a.pdf', uri: null }] }));
  assert.deepEqual(r.documents, []);
});

test('decimal sem ponto flutuante', () => {
  assert.equal(toDecimal(0.1 + 0.2), '0.3');
  assert.equal(toDecimal(54.96), '54.96');
  assert.equal(toDecimal(4), '4');
  assert.equal(toDecimal(null), null);
});

test('cursor avança página → modalidade → dia e termina em until', () => {
  const now = () => new Date('2026-11-13T15:00:00Z');
  const c = new PncpConnector({ modalities: [6, 8], since: new Date('2026-11-12T15:00:00Z'), now });
  const ini = c.initialCursor();
  assert.deepEqual(ini, { v: 1, day: '2026-11-12', until: '2026-11-13', modalities: [6, 8], modalityIndex: 0, page: 1 });
  assert.deepEqual(c.advance(ini, 3), { ...ini, page: 2 });
  assert.deepEqual(c.advance({ ...ini, page: 3 }, 3), { ...ini, modalityIndex: 1 });
  assert.deepEqual(c.advance({ ...ini, modalityIndex: 1 }, 0), { ...ini, day: '2026-11-13' });
  assert.equal(c.advance({ ...ini, day: '2026-11-13', modalityIndex: 1 }, 1), null);
  assert.throws(() => pncpCursor.parse({ v: 2 }));
});
