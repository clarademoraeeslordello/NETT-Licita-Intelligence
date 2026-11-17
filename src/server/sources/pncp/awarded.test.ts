/**
 * T-214 — resultados homologados por item → `OpportunityItem.awarded*`. Sem rede nem banco (fetch simulado).
 * Carregado por `pncp.test.ts` (`npm run test:sources`).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fecharDisjuntorConsulta } from '@/lib/pncp/disjuntor';
import { SourceRateLimited } from '../connector';
import fixtures from './__fixtures__/compras-reais.json';
import { MAX_ITENS_RESULTADOS, PncpConnector } from './connector';
import { normalizePncp, vencedorDoItem } from './normalize';

const ok = (r: ReturnType<typeof normalizePncp>) => {
  if ('skip' in r) throw new Error(r.skip);
  return r;
};
const CNPJ = '12345678000190';
const compra = (patch: Record<string, unknown> = {}) => ({ ...fixtures[0].compra, numeroControlePNCP: `${CNPJ}-1-000007/2026`, anoCompra: 2026, sequencialCompra: 7, ...patch });
/** Sequencial próprio por cenário: o cliente HTTP guarda cache por URL. */
const compraSeq = (seq: number, patch: Record<string, unknown> = {}) => compra({ numeroControlePNCP: `${CNPJ}-1-${String(seq).padStart(6, '0')}/2026`, sequencialCompra: seq, ...patch });
const item = (n: number, temResultado: boolean) => ({ ...fixtures[0].itens[0], numeroItem: n, temResultado });
const resultado = (patch: Record<string, unknown> = {}) => ({
  niFornecedor: '98765432000110',
  tipoPessoa: 'PJ',
  nomeRazaoSocialFornecedor: 'Fornecedora  Exemplo   LTDA',
  valorUnitarioHomologado: 54.96,
  quantidadeHomologada: 100,
  dataResultado: '2026-11-10T10:00:00',
  dataCancelamento: null,
  ...patch,
});

test('vencedor do item: maior quantidade (empate: menor preço), ignora cancelado/sem preço, nunca grava CPF', () => {
  const v = vencedorDoItem([resultado({ quantidadeHomologada: 10, valorUnitarioHomologado: 9 }), resultado({ quantidadeHomologada: 90, valorUnitarioHomologado: 54.96 })]);
  assert.deepEqual(v, { awardedUnitValue: '54.96', awardedSupplierCnpj: '98765432000110', awardedSupplierName: 'Fornecedora Exemplo LTDA', awardedAt: v!.awardedAt });
  assert.match(v!.awardedAt!, /^2026-11-10T/);
  assert.equal(vencedorDoItem([resultado({ quantidadeHomologada: 5, valorUnitarioHomologado: 8 }), resultado({ quantidadeHomologada: 5, valorUnitarioHomologado: 7 })])!.awardedUnitValue, '7');
  assert.equal(vencedorDoItem([resultado({ dataCancelamento: '2026-11-11T00:00:00' }), resultado({ valorUnitarioHomologado: 0 }), resultado({ valorUnitarioHomologado: null })]), null);
  assert.equal(vencedorDoItem([]), null);
  assert.equal(vencedorDoItem(undefined), null);
  const pf = vencedorDoItem([resultado({ niFornecedor: '12345678901', tipoPessoa: 'PF' })]);
  assert.equal(pf!.awardedSupplierCnpj, null, 'CPF de pessoa física não é gravado');
});

test('normalize: preenche awarded* só dos itens com resultado; sem `resultados` nada muda; o hash reflete o resultado', () => {
  const base = { compra: compra({ existeResultado: true, valorTotalHomologado: 1000 }), itens: [item(1, true), item(2, false)], arquivos: [] };
  const sem = ok(normalizePncp(base));
  assert.ok(sem.items.every((i) => i.awardedUnitValue === null && i.awardedSupplierCnpj === null));

  const com = ok(normalizePncp({ ...base, resultados: { '1': [resultado()], '2': [] } }));
  const [i1, i2] = com.items;
  assert.equal(i1!.awardedUnitValue, '54.96');
  assert.equal(i1!.awardedSupplierCnpj, '98765432000110');
  assert.equal(i2!.awardedUnitValue, null);
  assert.notEqual(com.opportunity.contentHash, sem.opportunity.contentHash);
  // Pura/estável.
  assert.deepEqual(com, ok(normalizePncp(structuredClone({ ...base, resultados: { '1': [resultado()], '2': [] } }))));
  // Resultado cancelado limpa o vencedor.
  const cancelado = ok(normalizePncp({ ...base, resultados: { '1': [resultado({ dataCancelamento: '2026-11-12T00:00:00' })] } }));
  assert.equal(cancelado.items[0]!.awardedUnitValue, null);
});

test('isEnriched: compra com resultado só está completa depois de consultar os resultados', () => {
  const c = new PncpConnector();
  const aberta = { compra: compra(), itens: [], arquivos: [] };
  assert.equal(c.isEnriched(aberta), true);
  const homologada = { compra: compra({ existeResultado: true }), itens: [], arquivos: [] };
  assert.equal(c.isEnriched(homologada), false);
  assert.equal(c.isEnriched({ ...homologada, resultados: {} }), true);
  assert.equal(c.isEnriched({ compra: compra({ valorTotalHomologado: 10 }), itens: [], arquivos: [] }), false);
  assert.equal(c.isEnriched({ compra: compra() }), false);
});

function fakeFetch(responder: (url: string) => { status: number; body?: unknown }) {
  const chamadas: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    chamadas.push(String(url));
    const r = responder(String(url));
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { chamadas, restaurar: () => void (globalThis.fetch = original) };
}
const rota = (url: string) => { const u = new URL(url); return (u.pathname + u.search).replace(new RegExp('/api/pncp/v1/orgaos/' + CNPJ + '/compras/2026/\\d+'), ''); };

test('enrich: consulta resultados só dos itens com resultado, tolera 404 de um item e guarda por número do item', async () => {
  fecharDisjuntorConsulta();
  const itens = [item(1, true), item(2, false), item(3, true)];
  const f = fakeFetch((url) => {
    const r = rota(url);
    if (r.startsWith('/itens?')) return { status: 200, body: itens };
    if (r === '/arquivos') return { status: 200, body: [] };
    if (r === '/itens/1/resultados') return { status: 200, body: [resultado()] };
    if (r === '/itens/3/resultados') return { status: 404 };
    return { status: 500 };
  });
  try {
    const p = await new PncpConnector().enrich({ compra: compra({ existeResultado: true }) });
    assert.deepEqual(f.chamadas.map(rota), ['/itens?pagina=1&tamanhoPagina=100', '/arquivos', '/itens/1/resultados', '/itens/3/resultados']);
    assert.deepEqual(Object.keys(p.resultados ?? {}), ['1', '3']);
    assert.deepEqual(p.resultados?.['3'], []); // 404 = sem resultado daquele item
    assert.equal(ok(normalizePncp(p)).items.find((i) => i.number === 1)!.awardedUnitValue, '54.96');
  } finally {
    f.restaurar();
    fecharDisjuntorConsulta();
  }
});

test('enrich: compra sem resultado não consulta resultados; o limite por compra vale; 429 para tudo sem retentar', async () => {
  fecharDisjuntorConsulta();
  const muitos = Array.from({ length: MAX_ITENS_RESULTADOS + 5 }, (_, i) => item(i + 1, true));
  const lista = fakeFetch((url) => {
    const r = rota(url);
    if (r.startsWith('/itens?')) return { status: 200, body: muitos };
    if (r === '/arquivos') return { status: 200, body: [] };
    return { status: 200, body: [resultado()] };
  });
  try {
    const c = new PncpConnector();
    const aberta = await c.enrich({ compra: compraSeq(8) });
    assert.equal(aberta.resultados, undefined);
    assert.equal(lista.chamadas.filter((u) => u.includes('/resultados')).length, 0);

    const comResultado = await c.enrich({ compra: compraSeq(9, { valorTotalHomologado: 500 }) });
    assert.equal(Object.keys(comResultado.resultados ?? {}).length, MAX_ITENS_RESULTADOS);
    assert.equal(lista.chamadas.filter((u) => u.includes('/resultados')).length, MAX_ITENS_RESULTADOS);
  } finally {
    lista.restaurar();
    fecharDisjuntorConsulta();
  }

  const limitada = fakeFetch((url) => {
    const r = rota(url);
    if (r.startsWith('/itens?')) return { status: 200, body: [item(1, true), item(2, true)] };
    if (r === '/arquivos') return { status: 200, body: [] };
    return { status: 429 };
  });
  try {
    await assert.rejects(new PncpConnector().enrich({ compra: compraSeq(10, { existeResultado: true }) }), (e) => e instanceof SourceRateLimited);
    assert.equal(limitada.chamadas.filter((u) => u.includes('/resultados')).length, 1, 'o 429 do item 1 interrompe: item 2 não é chamado e nada é retentado');
  } finally {
    limitada.restaurar();
    fecharDisjuntorConsulta();
  }
});
