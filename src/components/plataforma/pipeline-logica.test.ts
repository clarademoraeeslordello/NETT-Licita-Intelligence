import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  diaEmBrasilia,
  paraDecimal,
  podeMover,
  prontidao,
  renovacao,
  situacaoCertidao,
  somarCentavos,
  valorConquistado,
  valorEmDisputa,
  type CardApi,
  type CertidaoApi,
} from './pipeline-logica';

const card = (over: Partial<CardApi['tracking']> = {}, decisao: CardApi['latestBidDecision'] = null, estimado: string | null = '1000.00'): CardApi => ({
  tracking: { id: 't', stage: 'triage', proposalValue: null, outcome: null, bidDecisionReviewId: null, notes: '', updatedAt: '2026-11-17T00:00:00Z', ...over },
  opportunity: { id: 'o', title: 'x', agencyName: 'Órgão', uf: 'SP', modalityName: null, proposalsCloseAt: null, estimatedValue: estimado, url: 'https://pncp.gov.br/x' },
  latestBidDecision: decisao,
  latestAnalysis: null,
});

describe('podeMover (antecipa a regra do servidor)', () => {
  test('etapas iniciais não exigem parecer', () => {
    for (const e of ['triage', 'analysis', 'documentation'] as const) assert.deepEqual(podeMover(card(), e), { ok: true, bidDecisionReviewId: null });
  });
  test('proposal/dispute/result sem parecer → bloqueia com motivo', () => {
    for (const e of ['proposal', 'dispute', 'result'] as const) {
      const r = podeMover(card(), e);
      assert.equal(r.ok, false);
    }
  });
  test('parecer rejeitado mais recente bloqueia, mesmo que o card já guarde um id antigo', () => {
    const c = card({ bidDecisionReviewId: 'antigo' }, { id: 'novo', decision: 'rejected', createdAt: '2026-11-17T00:00:00Z' });
    assert.equal(podeMover(c, 'proposal').ok, false);
  });
  test('parecer aprovado (com ou sem ajustes) libera e devolve o id do parecer mais recente', () => {
    for (const decision of ['approved', 'approved_with_changes'] as const) {
      const r = podeMover(card({}, { id: 'p1', decision, createdAt: '2026-11-17T00:00:00Z' }), 'dispute');
      assert.deepEqual(r, { ok: true, bidDecisionReviewId: 'p1' });
    }
  });
  test('voltar para etapa que não exige parecer sempre é permitido', () => {
    const c = card({ stage: 'dispute' }, { id: 'p', decision: 'rejected', createdAt: '2026-11-17T00:00:00Z' });
    assert.equal(podeMover(c, 'analysis').ok, true);
  });
});

describe('dinheiro', () => {
  test('paraDecimal aceita formato brasileiro e decimal puro; recusa lixo, zero e negativo', () => {
    assert.equal(paraDecimal('185000'), '185000');
    assert.equal(paraDecimal('185.000'), '185000');
    assert.equal(paraDecimal('185.000,50'), '185000.50');
    assert.equal(paraDecimal('R$ 1.234,5'), '1234.5');
    assert.equal(paraDecimal('1500.25'), '1500.25');
    for (const ruim of ['', 'abc', '0', '-5', '1,2,3', '1.2.3', '12345678901234567', '1e5', '1.23456']) assert.equal(paraDecimal(ruim), null, ruim);
  });
  test('soma em centavos sem erro de ponto flutuante', () => {
    assert.equal(somarCentavos(['0.10', '0.20', null, undefined]), 30n);
    assert.equal(somarCentavos(['1234.5600', '0.44']), 123500n);
  });
  test('valor em disputa usa a proposta quando existe, senão o estimado; só etapas ativas; ganho só "won"', () => {
    const cards = [
      card({ stage: 'triage' }, null, '1000.00'),
      card({ stage: 'proposal', proposalValue: '800.50' }, null, '1000.00'),
      card({ stage: 'result', outcome: 'won', proposalValue: '300.00' }, null, '500.00'),
      card({ stage: 'result', outcome: 'lost' }, null, '9999.00'),
    ];
    assert.equal(valorEmDisputa(cards), 1800.5);
    assert.equal(valorConquistado(cards), 300);
  });
});

describe('cofre', () => {
  const agora = new Date('2026-11-17T15:00:00-03:00').getTime();
  test('situação respeita o fim do dia em Brasília e a janela de alerta', () => {
    assert.deepEqual(situacaoCertidao(null, agora), { situacao: 'permanente', dias: null });
    assert.equal(situacaoCertidao('2026-11-17', agora).situacao, 'a-vencer'); // vence hoje, ainda válida
    assert.equal(situacaoCertidao('2026-11-16', agora).situacao, 'vencido');
    assert.equal(situacaoCertidao('2026-12-01', agora).situacao, 'a-vencer');
    assert.equal(situacaoCertidao('2026-12-10', agora).situacao, 'valido');
  });
  test('prontidão: vazio = 0; vencidas reduzem', () => {
    const c = (validUntil: string | null): CertidaoApi => ({ id: validUntil ?? 'x', title: 't', category: 'fiscal', issuer: 'i', issuedAt: null, validUntil, defaultValidityDays: null, issueUrl: null, hasFile: false });
    assert.equal(prontidao([], agora), 0);
    assert.equal(prontidao([c('2027-01-01'), c('2026-01-01')], agora), 50);
    assert.equal(prontidao([c(null), c('2027-01-01')], agora), 100);
  });
  test('renovação: hoje em Brasília + validade usual; sem validade usual não renova', () => {
    const noite = new Date('2026-11-17T22:30:00-03:00').getTime(); // já é dia 18 em UTC
    assert.equal(diaEmBrasilia(0, noite), '2026-11-17');
    assert.deepEqual(renovacao({ defaultValidityDays: 30 }, noite), { issuedAt: '2026-11-17', validUntil: '2026-12-17' });
    assert.equal(renovacao({ defaultValidityDays: null }, noite), null);
  });
});
