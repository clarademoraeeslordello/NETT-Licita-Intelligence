/**
 * Comparison between the automatic assessment and human reviews (canonical `HumanReview`).
 * Produces metrics and SUGGESTIONS for human review only: nothing here changes weights, dictionary
 * or prompts (`automaticApply` is always false).
 *
 * Reading of HumanReview:
 *  - subjectType `bid_decision`: approved → participate · rejected → discard · approved_with_changes → participate;
 *  - subjectType `ai_analysis` corrections: `commercial.primaryCategory` (category) and
 *    `qualification.eligible` (boolean) are read when present; `comment` lines are the human reasons.
 */
import type { HumanReview } from '../../../contracts';
import { nettCategory, type NettCategory } from './dictionary';
import type { Decision, FitAssessmentResult } from './result';
import { tokens } from './text';
import { PRODUCTION_WEIGHTS } from './weights';

export type DivergenceType = 'agree' | 'false_positive' | 'false_negative' | 'partial';

export type Divergence = {
  opportunityId: string;
  versions: FitAssessmentResult['versions'];
  engineDecision: Decision;
  humanDecision: Decision;
  type: DivergenceType;
  engineCategory: NettCategory | null;
  humanCategory: NettCategory | null;
  categoryDiverges: boolean | null;
  engineEligible: boolean | null;
  humanEligible: boolean | null;
  eligibilityDiverges: boolean | null;
  uncoveredHumanReasons: string[];
};

export function humanDecisionOf(bid: HumanReview): Decision {
  if (bid.subjectType !== 'bid_decision') throw new Error('HumanReview não é bid_decision');
  return bid.decision === 'rejected' ? 'discard' : 'participate';
}

export function engineEligible(r: FitAssessmentResult): boolean | null {
  if (r.qualification.eliminatoryImpediments.length) return false;
  return r.qualification.score !== null && r.qualification.score >= PRODUCTION_WEIGHTS.recommendation.participateQualificationMin ? true : null;
}

export function divergenceType(engine: Decision, human: Decision): DivergenceType {
  if (engine === human) return 'agree';
  if (engine === 'participate' && human === 'discard') return 'false_positive';
  if (engine === 'discard' && human === 'participate') return 'false_negative';
  return 'partial';
}

function correction(review: HumanReview | undefined, path: string): unknown {
  return review?.corrections.find((c) => c.path === path)?.corrected;
}

function coverage(reason: string, engineTexts: string[][]): number {
  const target = new Set(tokens(reason).filter((t) => t.length > 2));
  if (!target.size) return 1;
  return Math.max(0, ...engineTexts.map((t) => [...target].filter((x) => t.includes(x)).length / target.size));
}

export function compareWithReviews(result: FitAssessmentResult, reviews: { bidDecision: HumanReview; analysisReview?: HumanReview }): Divergence {
  const human = humanDecisionOf(reviews.bidDecision);
  const cat = nettCategory.safeParse(correction(reviews.analysisReview, 'commercial.primaryCategory'));
  const eligible = correction(reviews.analysisReview, 'qualification.eligible');
  const humanEligible = typeof eligible === 'boolean' ? eligible : null;
  const engineTexts = [
    ...result.favorableReasons.map((m) => m.text),
    ...result.unfavorableReasons.map((m) => m.text),
    ...result.risks.map((x) => `${x.title} ${x.description}`),
    ...result.pendingItems.map((x) => x.description),
  ].map(tokens);
  const humanReasons = [reviews.bidDecision.comment, reviews.analysisReview?.comment]
    .filter((c): c is string => !!c)
    .flatMap((c) => c.split(/\n|;/))
    .map((s) => s.trim())
    .filter(Boolean);
  const mine = engineEligible(result);
  return {
    opportunityId: result.opportunityId,
    versions: result.versions,
    engineDecision: result.preliminaryRecommendation.decision,
    humanDecision: human,
    type: divergenceType(result.preliminaryRecommendation.decision, human),
    engineCategory: result.commercial.primaryCategory,
    humanCategory: cat.success ? cat.data : null,
    categoryDiverges: cat.success ? cat.data !== result.commercial.primaryCategory : null,
    engineEligible: mine,
    humanEligible,
    eligibilityDiverges: humanEligible === null || mine === null ? null : humanEligible !== mine,
    uncoveredHumanReasons: humanReasons.filter((m) => coverage(m, engineTexts) < 0.34),
  };
}

export type Suggestion = { description: string; opportunities: string[]; automaticApply: false };

export type DivergenceReport = {
  total: number;
  agreementRate: number;
  byType: Record<DivergenceType, number>;
  matrix: Record<string, Record<string, number>>;
  byVersion: Record<string, { total: number; agreement: number }>;
  categoryDivergences: number;
  eligibilityDivergences: number;
  recurringUncoveredReasons: { reason: string; count: number }[];
  suggestions: Suggestion[];
};

export function divergenceReport(divergences: Divergence[]): DivergenceReport {
  const byType: Record<DivergenceType, number> = { agree: 0, false_positive: 0, false_negative: 0, partial: 0 };
  const matrix: Record<string, Record<string, number>> = {};
  const byVersion: Record<string, { total: number; agreement: number }> = {};
  const reasons = new Map<string, number>();
  for (const d of divergences) {
    byType[d.type] += 1;
    const row = (matrix[d.engineDecision] ??= {});
    row[d.humanDecision] = (row[d.humanDecision] ?? 0) + 1;
    const key = `${d.versions.engine}|${d.versions.weights}|${d.versions.dictionary}`;
    const v = (byVersion[key] ??= { total: 0, agreement: 0 });
    v.total += 1;
    if (d.type === 'agree') v.agreement += 1;
    for (const m of d.uncoveredHumanReasons) reasons.set(m.toLowerCase(), (reasons.get(m.toLowerCase()) ?? 0) + 1);
  }
  for (const v of Object.values(byVersion)) v.agreement = v.total ? Math.round((v.agreement / v.total) * 100) / 100 : 0;

  const suggestions: Suggestion[] = [];
  const group = (list: Divergence[], key: (d: Divergence) => string) => {
    const m = new Map<string, string[]>();
    for (const d of list) m.set(key(d), [...(m.get(key(d)) ?? []), d.opportunityId]);
    return m;
  };
  for (const [cat, ops] of group(divergences.filter((d) => d.type === 'false_positive'), (d) => d.engineCategory ?? 'sem_categoria'))
    if (ops.length >= 2) suggestions.push({ description: `Revisar conceitos/pesos da categoria "${cat}": ${ops.length} recomendações de participação rejeitadas na decisão humana`, opportunities: ops, automaticApply: false });
  for (const [cat, ops] of group(divergences.filter((d) => d.categoryDiverges), (d) => d.humanCategory!))
    suggestions.push({ description: `Avaliar novas expressões para a categoria "${cat}" no dicionário (classificação divergente em ${ops.length} caso(s))`, opportunities: ops, automaticApply: false });
  const elig = divergences.filter((d) => d.eligibilityDiverges);
  if (elig.length) suggestions.push({ description: `Revisar regras de habilitação (${elig.length} divergência(s))`, opportunities: elig.map((d) => d.opportunityId), automaticApply: false });
  const fn = divergences.filter((d) => d.type === 'false_negative');
  if (fn.length) suggestions.push({ description: `Revisar motivos de descarte: ${fn.length} oportunidade(s) descartadas pelo motor e aprovadas na decisão humana`, opportunities: fn.map((d) => d.opportunityId), automaticApply: false });

  return {
    total: divergences.length,
    agreementRate: divergences.length ? Math.round((byType.agree / divergences.length) * 100) / 100 : 0,
    byType,
    matrix,
    byVersion,
    categoryDivergences: divergences.filter((d) => d.categoryDiverges).length,
    eligibilityDivergences: elig.length,
    recurringUncoveredReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    suggestions,
  };
}
