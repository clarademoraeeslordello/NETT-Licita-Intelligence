/** Risks, pending items, reasons, confidence and preliminary recommendation. The decision is human. */
import type { Opportunity } from '../../../contracts';
import type { CommercialScore } from './commercial';
import type { EvidenceRegistry } from './evidence';
import type { Finding } from './findings';
import type { InjectionAlert } from './injection';
import type { QualificationScore } from './qualification';
import type { AssessedRequirement, FitAssessmentResult, PendingItem, Reason, RequirementType, Risk } from './result';
import type { Weights } from './weights';

export const HUMAN_DECISION_NOTICE =
  'Recomendação preliminar gerada automaticamente. Não substitui análise jurídica nem a decisão humana, que deve conferir evidências e pendências e ser registrada em HumanReview (bid_decision).';

const AREA: Record<RequirementType, PendingItem['area']> = {
  technical_attestation: 'technical',
  company_certification: 'technical',
  professional: 'technical',
  tax_regularity: 'documents',
  legal_qualification: 'legal',
  financial: 'financial',
  operational_capacity: 'technical',
  participation: 'legal',
  site_visit: 'commercial',
  sample_poc: 'technical',
};

export type OpinionInput = {
  opportunity: Opportunity;
  commercial: CommercialScore;
  qualification: QualificationScore;
  findings: Finding[];
  alerts: InjectionAlert[];
  documents: FitAssessmentResult['documentsAnalyzed'];
  registry: EvidenceRegistry;
  weights: Weights;
  discardedLlmQuotes: number;
};

export function buildRisks(e: OpinionInput): Risk[] {
  const { registry } = e;
  const risks: Risk[] = [];
  for (const r of e.qualification.requirements) {
    if (r.eliminatory && r.situation === 'not_met')
      risks.push({ code: `impediment.${r.type}`, title: `Impedimento: ${r.description}`, level: 'high', description: r.rationale, eliminatory: true, evidence: r.evidence });
    else if (r.eliminatory && r.situation === 'unverified' && r.type !== 'legal_qualification' && r.type !== 'tax_regularity')
      risks.push({ code: `unverified.${r.type}`, title: `Requisito eliminatório sem comprovação: ${r.description}`, level: 'medium', description: r.rationale, eliminatory: false, evidence: r.evidence });
    else if (!r.eliminatory && r.situation === 'not_met')
      risks.push({ code: `operational.${r.type}`, title: r.description, level: 'medium', description: r.rationale, eliminatory: false, evidence: r.evidence });
  }
  const estimated = e.opportunity.estimatedValue === null ? null : Number(e.opportunity.estimatedValue);
  for (const f of e.findings) {
    if (f.type === 'fine' && f.percent >= 10)
      risks.push({ code: 'contract.fine', title: `Multa de ${f.percent}%`, level: f.percent >= 20 ? 'high' : 'medium', description: 'Penalidade contratual elevada', eliminatory: false, evidence: [registry.fromPassage(f.passage, 'Cláusula de multa')] });
    if (f.type === 'performance_guarantee')
      risks.push({ code: 'contract.guarantee', title: `Garantia contratual de ${f.percent}%`, level: f.percent >= 5 ? 'medium' : 'low', description: 'Exige garantia de execução (impacto financeiro)', eliminatory: false, evidence: [registry.fromPassage(f.passage, 'Cláusula de garantia')] });
    if (f.type === 'no_subcontracting')
      risks.push({ code: 'contract.no_subcontracting', title: 'Subcontratação vedada', level: 'low', description: 'Toda a execução deve ser própria', eliminatory: false, evidence: [registry.fromPassage(f.passage, 'Vedação de subcontratação')] });
    if (f.type === 'estimated_value' && estimated !== null && Math.abs(f.value - estimated) / Math.max(estimated, 1) > 0.01)
      risks.push({
        code: 'data.value_mismatch',
        title: 'Valor estimado divergente',
        level: 'medium',
        description: `Documento cita R$ ${f.value.toFixed(2)}; a oportunidade informa R$ ${estimated.toFixed(2)}`,
        eliminatory: false,
        evidence: [registry.fromPassage(f.passage, 'Valor citado no documento'), registry.fromOpportunity('estimatedValue', String(e.opportunity.estimatedValue), 'Valor da oportunidade')],
      });
  }
  for (const a of e.alerts) {
    const doc = e.documents.find((d) => d.documentId === a.documentId);
    risks.push({
      code: 'security.embedded_instruction',
      title: 'Documento contém instruções direcionadas a sistemas automatizados',
      level: 'high',
      description: 'Texto ignorado como instrução e tratado só como conteúdo. Conferir a integridade do arquivo na fonte oficial.',
      eliminatory: false,
      evidence: [registry.fromPassage({ documentId: a.documentId, documentTitle: doc?.title ?? a.documentId, role: 'other', page: a.page, section: null, sectionKind: 'other', text: a.excerpt }, 'Instrução embutida detectada')],
    });
  }
  if (!e.documents.length)
    risks.push({ code: 'data.no_documents', title: 'Nenhum documento analisado', level: 'high', description: 'Análise baseada apenas no objeto resumido da oportunidade', eliminatory: false, evidence: [registry.unverified('Edital e termo de referência não disponíveis')] });
  else if (!e.documents.some((d) => d.kind === 'reference_term'))
    risks.push({ code: 'data.no_reference_term', title: 'Termo de referência não analisado', level: 'medium', description: 'Requisitos técnicos podem estar incompletos', eliminatory: false, evidence: [registry.unverified('Termo de referência não disponível')] });
  const unread = e.documents.flatMap((d) => d.unreadPages.map((p) => `${d.title} p.${p}`));
  if (unread.length)
    risks.push({ code: 'data.unread_pages', title: 'Páginas sem texto legível', level: 'medium', description: `Não lidas: ${unread.slice(0, 10).join(', ')}${unread.length > 10 ? '…' : ''} (OCR pendente)`, eliminatory: false, evidence: [registry.unverified('Páginas sem camada de texto')] });
  const close = e.opportunity.proposalsCloseAt ?? '';
  if (e.commercial.daysToClose !== null && e.commercial.daysToClose < 0)
    risks.push({ code: 'deadline.closed', title: 'Prazo de propostas encerrado', level: 'high', description: 'Recebimento de propostas já encerrou', eliminatory: true, evidence: [registry.fromOpportunity('proposalsCloseAt', close, 'Encerramento das propostas')] });
  else if (e.commercial.daysToClose !== null && e.commercial.daysToClose < 3)
    risks.push({ code: 'deadline.short', title: 'Prazo curto para proposta', level: 'medium', description: `Encerra em ${Math.max(0, Math.floor(e.commercial.daysToClose))} dia(s)`, eliminatory: false, evidence: [registry.fromOpportunity('proposalsCloseAt', close, 'Encerramento das propostas')] });
  if (e.discardedLlmQuotes > 0)
    risks.push({ code: 'llm.discarded_quotes', title: 'Afirmações da IA sem lastro descartadas', level: 'low', description: `${e.discardedLlmQuotes} trecho(s) citado(s) pela IA não foram localizados no documento e foram ignorados`, eliminatory: false, evidence: [] });
  const order = { high: 0, medium: 1, low: 2 } as const;
  return risks.sort((a, b) => order[a.level] - order[b.level]);
}

export function buildPendingItems(e: OpinionInput): PendingItem[] {
  const out: PendingItem[] = [];
  for (const r of e.qualification.requirements) {
    if (r.situation === 'unverified') out.push({ code: `verify.${r.id}`, description: `${r.description} — ${r.rationale}`, area: AREA[r.type], evidence: r.evidence });
    if (r.situation === 'met_declared') out.push({ code: `confirm.${r.id}`, description: `${r.description} — conferência humana: ${r.rationale}`, area: AREA[r.type], evidence: r.evidence });
  }
  if (!e.documents.some((d) => d.kind === 'reference_term')) out.push({ code: 'fetch.reference_term', description: 'Obter e analisar o termo de referência', area: 'documents', evidence: [] });
  if (!e.documents.some((d) => d.kind === 'tender_notice')) out.push({ code: 'fetch.tender_notice', description: 'Obter e analisar o edital', area: 'documents', evidence: [] });
  if (e.opportunity.estimatedValue === null) out.push({ code: 'confirm.value', description: 'Valor estimado não informado na oportunidade', area: 'commercial', evidence: [] });
  return out;
}

export function buildReasons(e: OpinionInput): { favorable: Reason[]; unfavorable: Reason[] } {
  const favorable: Reason[] = [];
  const unfavorable: Reason[] = [];
  for (const f of e.commercial.factors) {
    const reason: Reason = { code: `commercial.${f.key}`, text: `${f.label}: ${f.detail}`, status: f.evidence.length ? 'proven' : 'unverified', evidence: f.evidence };
    if (f.points >= f.max * 0.7) favorable.push(reason);
    else if (f.points < f.max * 0.4) unfavorable.push(reason);
  }
  if (e.commercial.excludedBy)
    unfavorable.push({ code: 'commercial.excluded', text: `Objeto fora do perfil ("${e.commercial.excludedBy}")`, status: 'proven', evidence: e.commercial.factors[0]?.evidence ?? [] });
  const asReason = (r: AssessedRequirement): Reason => ({ code: `qualification.${r.id}`, text: `${r.description}: ${r.rationale}`, status: 'proven', evidence: r.evidence });
  favorable.push(...e.qualification.requirements.filter((r) => r.situation === 'met' && r.type !== 'legal_qualification').map(asReason));
  unfavorable.push(...e.qualification.requirements.filter((r) => r.situation === 'not_met').map(asReason));
  return { favorable, unfavorable };
}

export function computeConfidence(e: OpinionInput, categoryMargin: number): FitAssessmentResult['confidence'] {
  const why: string[] = [];
  let v = 0.2;
  const add = (delta: number, text: string) => {
    v += delta;
    why.push(text);
  };
  if (e.documents.some((d) => d.kind === 'tender_notice')) add(0.25, 'Edital analisado');
  else add(0, 'Edital não analisado');
  if (e.documents.some((d) => d.kind === 'reference_term')) add(0.15, 'Termo de referência analisado');
  else add(0, 'Termo de referência não analisado');
  const pages = e.documents.reduce((a, d) => a + d.pages, 0);
  const withText = e.documents.reduce((a, d) => a + d.pagesWithText, 0);
  if (pages) {
    v += 0.15 * (withText / pages);
    why.push(`${withText}/${pages} páginas com texto legível`);
  }
  v += 0.15 * Math.max(0, Math.min(1, categoryMargin / 40));
  why.push(categoryMargin >= 20 ? 'Categoria principal bem destacada' : 'Categorias próximas entre si (classificação ambígua)');
  const reqs = e.qualification.requirements;
  if (reqs.length) {
    const conclusive = reqs.filter((r) => r.situation === 'met' || r.situation === 'not_met').length;
    v += 0.1 * (conclusive / reqs.length);
    why.push(`${conclusive}/${reqs.length} requisitos com conclusão comprovada`);
  } else why.push('Nenhum requisito de habilitação localizado');
  if (e.alerts.length) add(-0.1, 'Instruções embutidas detectadas nos documentos');
  if (e.documents.some((d) => d.unreadPages.length)) add(-0.1, 'Há páginas não lidas');
  const value = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
  return { level: value >= 0.7 ? 'high' : value >= 0.45 ? 'medium' : 'low', value, rationale: why };
}

export function recommend(e: OpinionInput, risks: Risk[], confidence: FitAssessmentResult['confidence']): FitAssessmentResult['preliminaryRecommendation'] {
  const r = e.weights.recommendation;
  const discard: Reason[] = [];
  if (e.opportunity.status === 'cancelled') discard.push({ code: 'discard.cancelled', text: 'Contratação cancelada', status: 'proven', evidence: [e.registry.fromOpportunity('status', 'cancelled', 'Situação da oportunidade')] });
  for (const risk of risks.filter((x) => x.eliminatory)) discard.push({ code: `discard.${risk.code}`, text: `${risk.title} — ${risk.description}`, status: 'proven', evidence: risk.evidence });
  if (e.commercial.excludedBy) discard.push({ code: 'discard.out_of_profile', text: `Objeto fora do perfil ("${e.commercial.excludedBy}")`, status: 'proven', evidence: e.commercial.factors[0]?.evidence ?? [] });
  else if (e.commercial.score < r.discardCommercialMax)
    discard.push({ code: 'discard.low_fit', text: `Aderência comercial ${e.commercial.score} abaixo de ${r.discardCommercialMax}`, status: 'inferred', evidence: e.commercial.factors[0]?.evidence ?? [] });

  const q = e.qualification.score;
  const summary = `Comercial ${e.commercial.score}/100${e.commercial.primaryCategory ? ` (${e.commercial.categories[0]?.label})` : ''}; habilitação ${q === null ? 'sem requisitos localizados' : `${q}/100`}; confiança ${confidence.level}.`;
  if (discard.length) return { decision: 'discard', discardReasons: discard, rationale: `${summary} Motivo(s): ${discard.map((m) => m.text).join('; ')}.`, notice: HUMAN_DECISION_NOTICE };

  const highRisk = risks.some((x) => x.level === 'high');
  if (e.commercial.score >= r.participateCommercialMin && q !== null && q >= r.participateQualificationMin && confidence.level !== 'low' && !highRisk)
    return { decision: 'participate', discardReasons: [], rationale: `${summary} Sem impedimentos eliminatórios identificados.`, notice: HUMAN_DECISION_NOTICE };

  const why: string[] = [];
  if (e.commercial.score < r.participateCommercialMin) why.push('aderência comercial intermediária');
  if (q === null) why.push('requisitos de habilitação não localizados');
  else if (q < r.participateQualificationMin) why.push('habilitação com pendências relevantes');
  if (confidence.level === 'low') why.push('confiança baixa');
  if (highRisk) why.push('risco alto identificado');
  return { decision: 'evaluate', discardReasons: [], rationale: `${summary} Requer avaliação humana: ${why.join(', ')}.`, notice: HUMAN_DECISION_NOTICE };
}
