/** T-305 eligibility unit tests (no database). Run: `npm run test:analysis` */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hardFilter, termsMatch, textTokens, type EligibilityOpportunity, type EligibilityProfile } from './eligibility';

const opp: EligibilityOpportunity = { uf: 'RN', modalityCode: 6, estimatedValue: '180000.0000', title: 'Pregão 99/2026', objectDescription: 'Consultoria para adequação à LGPD e mapeamento de dados pessoais' };
const profile = (over: Partial<EligibilityProfile> = {}): EligibilityProfile => ({ ufs: [], modalityCodes: [], minValue: null, maxValue: null, sourceKeys: [], includeTerms: ['lgpd'], ...over });

describe('hardFilter', () => {
  test('perfil aberto não descarta nada', () => assert.equal(hardFilter(opp, 'pncp', profile()), null));

  test('cada filtro descarta pelo seu motivo', () => {
    assert.equal(hardFilter(opp, 'pncp', profile({ ufs: ['SP', 'MG'] })), 'uf');
    assert.equal(hardFilter(opp, 'pncp', profile({ modalityCodes: [4, 8] })), 'modality');
    assert.equal(hardFilter(opp, 'pncp', profile({ minValue: '200000' })), 'value');
    assert.equal(hardFilter(opp, 'pncp', profile({ maxValue: '100000' })), 'value');
    assert.equal(hardFilter(opp, 'pncp', profile({ sourceKeys: ['outra'] })), 'source');
    assert.equal(hardFilter(opp, null, profile({ sourceKeys: ['pncp'] })), 'source');
  });

  test('dentro da faixa e nos limites exatos mantém', () => {
    assert.equal(hardFilter(opp, 'pncp', profile({ ufs: ['RN'], modalityCodes: [6], minValue: '180000', maxValue: '180000', sourceKeys: ['pncp'] })), null);
  });

  test('na dúvida mantém: UF, modalidade e valor desconhecidos (ou sigiloso) não descartam', () => {
    const unknown = { ...opp, uf: null, modalityCode: null, estimatedValue: null };
    assert.equal(hardFilter(unknown, 'pncp', profile({ ufs: ['SP'], modalityCodes: [4], minValue: '500000', maxValue: '600000' })), null);
  });
});

describe('termsMatch', () => {
  const t = textTokens(opp.title, opp.objectDescription);
  test('casa por radical e fora de ordem; qualquer termo basta', () => {
    assert.ok(termsMatch(t, ['lgpd']));
    assert.ok(termsMatch(t, ['dados pessoais mapeamento']));
    assert.ok(termsMatch(t, ['merenda', 'adequações']), 'plural casa com singular');
  });
  test('sem termo no texto não casa', () => {
    assert.equal(termsMatch(t, ['merenda escolar', 'notebook']), false);
    assert.equal(termsMatch(t, []), false);
  });
});
