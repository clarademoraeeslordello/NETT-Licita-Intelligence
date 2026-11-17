/**
 * T-213 / ADR-023 — partição `proposals` do PNCP: cursor por feed, retomada, 429 nunca retentado. Sem rede nem banco
 * (fetch simulado). Carregado por `pncp.test.ts` (`npm run test:sources`).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consultaBloqueada, fecharDisjuntorConsulta } from '@/lib/pncp/disjuntor';
import { sourceSchedules } from '../../jobs/handlers';
import { SourceRateLimited } from '../connector';
import { CONTINUATION_DELAY_MS, continuationDelayMs, type SyncResult } from '../sync';
import { feedsOf, PncpConnector, pncpProposalsCursor } from './connector';

const agora = () => new Date('2026-11-17T15:00:00Z');
const proposals = () => new PncpConnector({ modalities: [6, 8], now: agora, proposalsHorizonDays: 30 });

test('proposals: cursor inicial usa dataFinal no horizonte e avança página → modalidade, terminando na última', () => {
  const c = proposals();
  const ini = c.initialProposalsCursor();
  assert.deepEqual(ini, { v: 1, feed: 'proposals', until: '2026-12-17', modalities: [6, 8], modalityIndex: 0, page: 1 });
  assert.deepEqual(c.advanceProposals(ini, 3), { ...ini, page: 2 });
  assert.deepEqual(c.advanceProposals({ ...ini, page: 3 }, 3), { ...ini, modalityIndex: 1 });
  assert.equal(c.advanceProposals({ ...ini, modalityIndex: 1 }, 1), null);
  assert.equal(c.advanceProposals({ ...ini, modalityIndex: 1 }, 0), null); // 204/vazio
  assert.throws(() => pncpProposalsCursor.parse({ ...ini, feed: 'updates' }));
});

test('cursor por feed em Source.lastCursor: aceita o formato antigo e guarda um feed sem apagar o outro', () => {
  const c = proposals();
  const antigo = { v: 1, day: '2026-11-16', until: '2026-11-17', modalities: [6, 8], modalityIndex: 1, page: 4 };
  assert.deepEqual(feedsOf(antigo), { updates: antigo });
  assert.deepEqual(c.resumeCursor(antigo, 'updates'), antigo);
  assert.equal(c.resumeCursor(antigo, 'proposals'), null); // o formato antigo não tem proposals

  const prop = { ...c.initialProposalsCursor(), page: 7 };
  const gravado = c.storeCursor(antigo, 'proposals', prop) as { v: number; feeds: Record<string, unknown> };
  assert.equal(gravado.v, 2);
  assert.deepEqual(gravado.feeds, { updates: antigo, proposals: prop });
  // O updates avança sem apagar o cursor de proposals.
  const avancado = c.storeCursor(gravado, 'updates', { ...antigo, page: 5 }) as { feeds: Record<string, unknown> };
  assert.deepEqual(avancado.feeds.proposals, prop);
  assert.equal((avancado.feeds.updates as { page: number }).page, 5);
  assert.deepEqual(c.resumeCursor(avancado, 'proposals'), prop); // retomável: mesma página
  assert.deepEqual(feedsOf(null), {});
  assert.deepEqual(feedsOf({ v: 2, feeds: 'x' }), {});
});

test('proposals: varredura concluída recomeça do início com dataFinal renovado; mudança de modalidades também', () => {
  const c = proposals();
  const fim = c.completedCursor({ ...c.initialProposalsCursor(), modalityIndex: 1, page: 9 }) as { done: boolean };
  assert.equal(fim.done, true);
  const depois = new PncpConnector({ modalities: [6, 8], now: () => new Date('2026-11-18T15:00:00Z'), proposalsHorizonDays: 30 });
  assert.deepEqual(depois.resumeCursor({ v: 2, feeds: { proposals: fim } }, 'proposals'), { v: 1, feed: 'proposals', until: '2026-12-18', modalities: [6, 8], modalityIndex: 0, page: 1 });
  const outras = new PncpConnector({ modalities: [6], now: agora, proposalsHorizonDays: 30 });
  const meio = { ...c.initialProposalsCursor(), page: 5 };
  assert.equal((outras.resumeCursor({ v: 2, feeds: { proposals: meio } }, 'proposals') as { page: number }).page, 1);
  // O cursor do updates nunca é marcado como concluído.
  assert.deepEqual(c.completedCursor(c.initialCursor()), c.initialCursor());
});

function fakeFetch(respostas: Array<{ status: number; body?: unknown }>) {
  const chamadas: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    chamadas.push(String(url));
    const r = respostas[Math.min(chamadas.length - 1, respostas.length - 1)]!;
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { chamadas, restaurar: () => void (globalThis.fetch = original) };
}

test('proposals: consulta /contratacoes/proposta com dataFinal, modalidade e página de 50; devolve registros e próximo cursor', async () => {
  fecharDisjuntorConsulta();
  const f = fakeFetch([{ status: 200, body: { data: [{ numeroControlePNCP: '1-1-000001/2026' }, { sem: 'numero' }], totalPaginas: 2 } }]);
  try {
    const c = proposals();
    const r = await c.fetchPage(c.initialProposalsCursor());
    const url = new URL(f.chamadas[0]!);
    assert.equal(url.pathname, '/api/consulta/v1/contratacoes/proposta');
    assert.deepEqual(Object.fromEntries(url.searchParams), { dataFinal: '20261217', codigoModalidadeContratacao: '6', pagina: '1', tamanhoPagina: '50' });
    assert.deepEqual(r.records.map((x) => x.externalId), ['1-1-000001/2026']);
    assert.equal((r.nextCursor as { page: number }).page, 2);
  } finally {
    f.restaurar();
    fecharDisjuntorConsulta();
  }
});

test('HTTP 429 nunca é retentado: 1 requisição, SourceRateLimited, cooldown aberto e nenhuma chamada durante ele', async () => {
  fecharDisjuntorConsulta();
  const f = fakeFetch([{ status: 429 }, { status: 200, body: { data: [], totalPaginas: 0 } }]);
  try {
    const c = proposals();
    await assert.rejects(c.fetchPage(c.initialProposalsCursor()), (e) => e instanceof SourceRateLimited && e.cooldownMs >= 60_000);
    assert.equal(f.chamadas.length, 1, 'o 429 não pode ser retentado');
    assert.equal(consultaBloqueada(), true);
    await assert.rejects(c.fetchPage(c.initialProposalsCursor()), (e) => e instanceof SourceRateLimited);
    assert.equal(f.chamadas.length, 1, 'em cooldown não se chama o PNCP');
    await assert.rejects(c.fetchPage(c.initialCursor()), (e) => e instanceof SourceRateLimited); // o feed updates tem a mesma proteção
    assert.equal(f.chamadas.length, 1);
  } finally {
    f.restaurar();
    fecharDisjuntorConsulta();
  }
});

test('429 no enriquecimento também para, sem retentar', async () => {
  fecharDisjuntorConsulta();
  const f = fakeFetch([{ status: 429 }]);
  try {
    await assert.rejects(proposals().enrich({ compra: { numeroControlePNCP: '12345678000190-1-000001/2026' } }), (e) => e instanceof SourceRateLimited);
    assert.equal(f.chamadas.length, 1);
  } finally {
    f.restaurar();
    fecharDisjuntorConsulta();
  }
});

test('continuação do sync: só proposals incremental; orçamento → 30 s; 429 → espera o cooldown inteiro', () => {
  const base: SyncResult = { status: 'partial', feed: 'proposals', pages: 1, records: 0, newRecords: 0, matched: 0, enriched: 0, enrichErrors: 0, stoppedBy: 'time_budget' };
  const inc = { sourceKey: 'pncp', mode: 'incremental' as const, feed: 'proposals' as const };
  assert.equal(continuationDelayMs(inc, base), CONTINUATION_DELAY_MS);
  assert.equal(continuationDelayMs(inc, { ...base, stoppedBy: 'max_pages' }), CONTINUATION_DELAY_MS);
  assert.equal(continuationDelayMs(inc, { ...base, stoppedBy: 'enrich_budget' }), CONTINUATION_DELAY_MS);
  assert.equal(continuationDelayMs(inc, { ...base, stoppedBy: 'rate_limited', cooldownMs: 900_000 }), 900_000);
  assert.equal(continuationDelayMs(inc, { ...base, stoppedBy: 'caught_up', status: 'ok' }), null);
  assert.equal(continuationDelayMs(inc, { ...base, stoppedBy: 'error', status: 'error' }), null); // erro real: pg-boss retenta
  assert.equal(continuationDelayMs({ ...inc, mode: 'backfill' }, base), null);
  assert.equal(continuationDelayMs({ sourceKey: 'pncp', mode: 'incremental' }, { ...base, feed: 'updates' }), null);
});

test('agendamento das propostas abertas: a cada 6 h por padrão, desligável, sem alterar os crons existentes', () => {
  const padrao = sourceSchedules({});
  assert.deepEqual(
    padrao.map((s) => [s.cron, s.data.mode, s.data.feed]),
    [
      ['7 * * * *', 'incremental', undefined],
      ['17 4 * * *', 'backfill', undefined],
      ['23 */6 * * *', 'incremental', 'proposals'],
    ],
  );
  assert.equal(sourceSchedules({ SOURCE_PROPOSALS_CRON: '' }).some((s) => s.data.feed === 'proposals'), false);
});
