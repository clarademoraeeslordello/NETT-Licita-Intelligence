/**
 * A. Commercial/technical fit (0–100), independent from qualification.
 * Region/value/deadline/modality factors follow `src/lib/plataforma/aderencia.ts` (LicitaFlow);
 * the object factor comes from the semantic classification into Nett categories.
 * Factor keys match `matchFactor` in src/contracts/analysis.ts.
 */
import type { Opportunity, SearchProfile } from '../../../contracts';
import { diasAte } from '../../../lib/plataforma/aderencia';
import type { Classification, Segment } from './classifier';
import type { EvidenceRegistry } from './evidence';
import type { Factor, FitAssessmentResult } from './result';
import type { Weights } from './weights';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function segmentEvidence(s: Segment, registry: EvidenceRegistry, rationale: string): string {
  return s.origin.type === 'passage' ? registry.fromPassage(s.origin.passage, rationale) : registry.fromOpportunity(s.origin.field, s.text, rationale);
}

export type CommercialScore = FitAssessmentResult['commercial'] & { daysToClose: number | null; excludedBy: string | null };

export function scoreCommercial(
  opp: Opportunity,
  classification: Classification,
  profile: SearchProfile | null,
  registry: EvidenceRegistry,
  weights: Weights,
  now: number,
): CommercialScore {
  const w = weights.commercial;
  const categories = classification.categories.map((c) => ({
    category: c.category,
    label: c.label,
    score: c.score,
    concepts: c.concepts.map((k) => k.label),
    evidence: c.concepts.flatMap((k) => k.segments.slice(0, 2).map((s) => segmentEvidence(s, registry, `Indica "${k.label}" (${c.label})`))),
  }));
  const top = classification.categories[0];
  const fit = top && top.score >= weights.thresholds.categoryFit ? top : null;

  const object: Factor = {
    key: 'object',
    label: 'Objeto × categorias Nett',
    points: Math.round(((top?.score ?? 0) / 100) * w.object * 10) / 10,
    max: w.object,
    detail: fit ? `${fit.label}: ${fit.concepts.map((k) => k.label).join('; ')}` : 'Nenhuma categoria da Nett caracteriza o objeto',
    evidence: fit ? (categories[0]?.evidence ?? []) : [registry.fromOpportunity('objectDescription', opp.objectDescription, 'Objeto avaliado sem correspondência no dicionário Nett')],
  };

  const ufs = profile?.ufs ?? [];
  const ufOk = opp.uf !== null && ufs.includes(opp.uf);
  const region: Factor = {
    key: 'region',
    label: 'Região',
    points: ufs.length === 0 ? w.region * 0.7 : ufOk ? w.region : 0,
    max: w.region,
    detail: ufs.length === 0 ? 'Perfil sem restrição de UF' : ufOk ? `${opp.uf} na área de atuação` : `${opp.uf ?? 'UF não informada'} fora da área de atuação`,
    evidence: opp.uf ? [registry.fromOpportunity('uf', opp.uf, 'UF da contratação')] : [],
  };

  const estimated = opp.estimatedValue === null ? null : Number(opp.estimatedValue);
  const min = profile?.minValue ? Number(profile.minValue) : null;
  const max = profile?.maxValue ? Number(profile.maxValue) : null;
  let valuePoints = w.value * 0.5;
  let valueDetail = opp.confidentialBudget ? 'Orçamento sigiloso (neutro)' : 'Valor estimado não informado (neutro)';
  if (estimated !== null) {
    if (min !== null && estimated < min) [valuePoints, valueDetail] = [w.value * 0.3, `${brl(estimated)} abaixo do valor mínimo do perfil`];
    else if (max !== null && estimated > max) [valuePoints, valueDetail] = [w.value * 0.2, `${brl(estimated)} acima do valor máximo do perfil`];
    else [valuePoints, valueDetail] = [w.value, `${brl(estimated)} dentro da faixa do perfil`];
  }
  const value: Factor = {
    key: 'value',
    label: 'Valor',
    points: valuePoints,
    max: w.value,
    detail: valueDetail,
    evidence: opp.estimatedValue !== null ? [registry.fromOpportunity('estimatedValue', opp.estimatedValue, 'Valor estimado da oportunidade')] : [],
  };

  const days = diasAte(opp.proposalsCloseAt, now);
  let deadlinePoints = w.deadline * 0.5;
  let deadlineDetail = 'Encerramento não informado';
  if (days !== null) {
    if (days < 0) [deadlinePoints, deadlineDetail] = [0, 'Recebimento de propostas encerrado'];
    else if (days < 1) [deadlinePoints, deadlineDetail] = [w.deadline * 0.1, 'Encerra em menos de 24 horas'];
    else if (days < 3) [deadlinePoints, deadlineDetail] = [w.deadline * 0.4, `Encerra em ${Math.floor(days)} dia(s)`];
    else if (days < 7) [deadlinePoints, deadlineDetail] = [w.deadline * 0.75, `Encerra em ${Math.floor(days)} dias`];
    else [deadlinePoints, deadlineDetail] = [w.deadline, `${Math.floor(days)} dias para preparar a proposta`];
  }
  const deadline: Factor = {
    key: 'deadline',
    label: 'Prazo',
    points: deadlinePoints,
    max: w.deadline,
    detail: deadlineDetail,
    evidence: opp.proposalsCloseAt ? [registry.fromOpportunity('proposalsCloseAt', opp.proposalsCloseAt, 'Encerramento das propostas')] : [],
  };

  const modalities = profile?.modalityCodes ?? [];
  const modalityOk = opp.modalityCode !== null && modalities.includes(opp.modalityCode);
  const modality: Factor = {
    key: 'modality',
    label: 'Modalidade',
    points: modalities.length === 0 || modalityOk ? w.modality : w.modality * 0.4,
    max: w.modality,
    detail: modalities.length === 0 ? 'Perfil sem preferência de modalidade' : modalityOk ? `${opp.modalityName} preferida` : `${opp.modalityName ?? 'Modalidade'} fora das preferidas`,
    evidence: opp.modalityName ? [registry.fromOpportunity('modalityName', opp.modalityName, 'Modalidade da contratação')] : [],
  };

  const factors = [object, region, value, deadline, modality];
  let score = Math.round(factors.reduce((acc, f) => acc + f.points, 0));
  const caps: string[] = [];
  const excludedBy = classification.exclusions[0]?.expression ?? null;
  if (excludedBy) {
    score = Math.min(score, weights.thresholds.capExcluded);
    caps.push('excluded_term');
  } else if (opp.status === 'cancelled') {
    score = Math.min(score, weights.thresholds.capCancelled);
    caps.push('cancelled');
  } else if (!fit) {
    score = Math.min(score, weights.thresholds.capNoCategory);
    caps.push('no_term_match');
  }
  return {
    score,
    band: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low',
    primaryCategory: fit?.category ?? null,
    categories,
    factors,
    caps,
    daysToClose: days,
    excludedBy,
  };
}
