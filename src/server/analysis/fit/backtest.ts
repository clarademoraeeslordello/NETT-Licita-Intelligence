/**
 * Backtest of a candidate weights/dictionary version against recorded human decisions.
 * Justifies (or rejects) an engine evolution BEFORE it is manually promoted. Writes nothing.
 * Each case carries the exact input snapshot and instant of the original assessment.
 */
import type { Dictionary } from './dictionary';
import { runFitAssessment, type FitAssessmentInput } from './engine';
import type { Decision, FitAssessmentResult } from './result';
import { divergenceType } from './review';
import type { Weights } from './weights';

export type BacktestCase = { input: FitAssessmentInput; baseline: FitAssessmentResult; humanDecision: Decision };

export type BacktestResult = {
  cases: number;
  baseline: { agreement: number };
  candidate: { weights: string; dictionary: string; agreement: number };
  changes: { opportunityId: string; before: Decision; after: Decision; human: Decision }[];
};

export async function backtest(cases: BacktestCase[], candidate: { weights: Weights; dictionary: Dictionary }): Promise<BacktestResult> {
  let before = 0;
  let after = 0;
  const changes: BacktestResult['changes'] = [];
  for (const c of cases) {
    const redo = await runFitAssessment(c.input, { now: new Date(c.baseline.generatedAt), weights: candidate.weights, dictionary: candidate.dictionary });
    const b = c.baseline.preliminaryRecommendation.decision;
    const a = redo.preliminaryRecommendation.decision;
    if (divergenceType(b, c.humanDecision) === 'agree') before += 1;
    if (divergenceType(a, c.humanDecision) === 'agree') after += 1;
    if (a !== b) changes.push({ opportunityId: c.baseline.opportunityId, before: b, after: a, human: c.humanDecision });
  }
  const rate = (x: number) => (cases.length ? Math.round((x / cases.length) * 100) / 100 : 0);
  return { cases: cases.length, baseline: { agreement: rate(before) }, candidate: { weights: candidate.weights.version, dictionary: candidate.dictionary.version, agreement: rate(after) }, changes };
}
