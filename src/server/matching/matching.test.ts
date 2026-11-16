/** T-305 unit tests (no database). Run: `npm run test:analysis` */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { matchFactor } from '../../contracts';
import { bandOf } from '../analysis/fit/commercial';
import { runFitAssessment } from '../analysis/fit/engine';
import { PRODUCTION_WEIGHTS, WEIGHTS_V1, type Weights } from '../analysis/fit/weights';
import { lgpdInput, merendaInput, notebooksInput, NOW, profile } from '../analysis/fit/fixtures.test-data';
import { algorithmVersionOf, computeMatch } from './score';

/** Same opportunity, no documents: this is exactly what match.score sees at ingestion time. */
const withoutDocs = (i: ReturnType<typeof lgpdInput>) => ({ ...i, documents: [] });

describe('uma única nota comercial', () => {
  for (const [name, make] of [['LGPD', lgpdInput], ['merenda (fora do perfil)', merendaInput], ['notebooks', notebooksInput]] as const) {
    test(`match.score == commercial do fit_assessment (${name})`, async () => {
      const input = withoutDocs(make());
      const p = profile();
      const fit = await runFitAssessment({ ...input, searchProfile: p }, { now: NOW });
      const m = computeMatch({ opportunity: input.opportunity, items: input.items, profile: p, now: NOW });
      assert.equal(m.score, fit.commercial.score);
      assert.equal(m.primaryCategory, fit.commercial.primaryCategory);
      assert.deepEqual(m.caps, fit.commercial.caps);
      assert.deepEqual(m.factors.map((f) => [f.key, f.points, f.max]), fit.commercial.factors.map((f) => [f.key, f.points, f.max]));
      assert.equal(m.band, fit.commercial.band);
    });
  }
});

describe('computeMatch', () => {
  const base = () => lgpdInput();
  const run = (over: Parameters<typeof profile>[0] | null, now = NOW) => computeMatch({ opportunity: base().opportunity, items: base().items, profile: over === null ? null : profile(over), now });

  test('fatores seguem o contrato matchFactor e a faixa vem da definição única', () => {
    const m = run({});
    for (const f of m.factors) assert.ok(matchFactor.safeParse(f).success);
    assert.equal(m.band, bandOf(m.score));
    assert.equal(m.score, Math.round(m.factors.reduce((a, f) => a + f.points, 0)));
    assert.equal(m.algorithmVersion, 'fit-engine-1.0.0|weights-1.0.0|nett-dictionary-1.0.0');
  });

  test('o perfil importa: UF fora da área e valor acima do máximo reduzem a nota; sem perfil fica neutro', () => {
    const fit = run({});
    const outside = run({ ufs: ['SP'] });
    const tooBig = run({ maxValue: '100000.00' });
    assert.ok(outside.score < fit.score, 'região');
    assert.ok(tooBig.score < fit.score, 'valor');
    const neutral = run(null);
    assert.equal(neutral.primaryCategory, 'lgpd');
    assert.ok(neutral.factors.find((f) => f.key === 'region')!.detail.includes('sem restrição'));
  });

  test('termo excluído do perfil trava a nota; objeto fora do perfil não tem categoria', () => {
    const excluded = run({ excludeTerms: ['mapeamento de dados'] });
    assert.deepEqual(excluded.caps, ['excluded_term']);
    assert.ok(excluded.score <= PRODUCTION_WEIGHTS.thresholds.capExcluded);
    const m = computeMatch({ opportunity: merendaInput().opportunity, items: [], profile: null, now: NOW });
    assert.equal(m.primaryCategory, null);
    assert.ok(m.score <= PRODUCTION_WEIGHTS.thresholds.capExcluded);
  });

  test('a nota depende do tempo (prazo): perto do encerramento cai; versão de pesos entra no algorithmVersion', () => {
    const early = run({}, NOW);
    const late = run({}, new Date('2026-11-30T08:00:00-03:00'));
    assert.ok(late.score < early.score);
    const candidate: Weights = { ...WEIGHTS_V1, version: 'weights-9.9.9' };
    assert.notEqual(algorithmVersionOf(candidate), algorithmVersionOf());
  });
});
