/**
 * B. Qualification capacity (0–100), independent from the commercial fit.
 *
 * Each extracted requirement is checked against the company's canonical data
 * (Company, CompanyCapability, Document kind=company_certificate). This data is NEVER sent to an LLM
 * (ADR-008). Missing data = "unverified" (never "met"); "not_met" only when the data proves otherwise
 * or the capability kind is declared complete by the caller.
 */
import type { z } from 'zod';
import type { capabilityKind, Company, CompanyCapability, Document } from '../../../contracts';
import type { NettCategory, Dictionary } from './dictionary';
import { classify } from './classifier';
import type { EvidenceRegistry } from './evidence';
import type { ExtractedRequirement, TaxSubtype } from './requirements';
import type { AssessedRequirement, FitAssessmentResult, RequirementSituation } from './result';
import { normalize } from './text';
import type { Weights } from './weights';

export type CompanyData = {
  company: Company;
  capabilities: CompanyCapability[];
  certificates: Document[];
  /** Capability kinds the caller declares exhaustive: absence then means "not_met". */
  completeKinds: CapabilityKind[];
};

type CapabilityKind = z.infer<typeof capabilityKind>;

type Ctx = CompanyData & { category: NettCategory | null; estimatedValue: number | null; uf: string | null; today: string; registry: EvidenceRegistry; dictionary: Dictionary };
type Assessment = { situation: RequirementSituation; rationale: string; evidence: string[] };

const backedCap = (c: CompanyCapability) => c.evidenceDocumentId !== null;
const backedCert = (d: Document) => d.storageKey !== null || d.sha256 !== null;
const bySource = (backed: boolean): RequirementSituation => (backed ? 'met' : 'met_declared');
const capText = (c: CompanyCapability) => normalize([c.name, c.description, ...c.keywords].join(' '));

function unverified(rationale: string, ctx: Ctx): Assessment {
  return { situation: 'unverified', rationale, evidence: [ctx.registry.unverified(rationale)] };
}

function missing(ctx: Ctx, kind: CapabilityKind, what: string): Assessment {
  if (ctx.completeKinds.includes(kind))
    return { situation: 'not_met', rationale: `${what} não consta nas capacidades da empresa (tipo "${kind}" declarado completo)`, evidence: [ctx.registry.inferred(`Capacidades "${kind}" declaradas completas e sem ${what}`)] };
  return unverified(`${what} não cadastrado para a empresa — conferir`, ctx);
}

function activeCaps(ctx: Ctx, kind: CapabilityKind): CompanyCapability[] {
  return ctx.capabilities.filter((c) => c.active && c.kind === kind);
}

const TAX_MATCH: Record<TaxSubtype, (d: Document) => boolean> = {
  federal: (d) => d.certificate!.category === 'fiscal' && /receita|federal|pgfn|uni[aã]o/i.test(d.certificate!.issuer),
  fgts: (d) => /caixa|fgts|crf/i.test(`${d.certificate!.issuer} ${d.title}`),
  labor: (d) => d.certificate!.category === 'trabalhista',
  state: (d) => d.certificate!.category === 'fiscal' && /estad|sefaz/i.test(d.certificate!.issuer),
  municipal: (d) => d.certificate!.category === 'fiscal' && /munic|prefeitura/i.test(d.certificate!.issuer),
  sicaf: (d) => /sicaf/i.test(`${d.certificate!.issuer} ${d.title}`),
  bankruptcy: (d) => (d.certificate!.category === 'juridica' || d.certificate!.category === 'economica') && /fal[eê]ncia|recupera|tribunal|justi[cç]a/i.test(`${d.certificate!.issuer} ${d.title}`),
};

function assess(req: ExtractedRequirement, ctx: Ctx): Assessment {
  const { registry } = ctx;
  const p = req.params;
  switch (req.type) {
    case 'company_certification': {
      const code = String(p.standard ?? '').replace(/\D/g, '') || normalize(String(p.standard ?? ''));
      const cap = activeCaps(ctx, 'certification').find((c) => capText(c).replace(/\s+/g, '').includes(code));
      if (!cap) return missing(ctx, 'certification', `Certificação ${p.standard}`);
      const ev = registry.fromCompany('capabilities', `${cap.name}${cap.validUntil ? ` válida até ${cap.validUntil}` : ''}`, backedCap(cap));
      if (cap.validUntil && cap.validUntil < ctx.today) return { situation: 'not_met', rationale: `${cap.name} vencida em ${cap.validUntil}`, evidence: [ev] };
      return { situation: bySource(backedCap(cap)), rationale: `Empresa possui ${cap.name}`, evidence: [ev] };
    }
    case 'professional': {
      if (!p.certification) return unverified(`Formação exigida (${p.degree ?? 'não detalhada'}) não é verificável automaticamente`, ctx);
      const target = normalize(String(p.certification));
      const cap = activeCaps(ctx, 'certification').find((c) => capText(c).includes(target));
      if (!cap) return missing(ctx, 'certification', `Profissional com ${p.certification}`);
      const ev = registry.fromCompany('capabilities', `${cap.name}`, backedCap(cap));
      if (cap.validUntil && cap.validUntil < ctx.today) return { situation: 'not_met', rationale: `${cap.name} vencida em ${cap.validUntil}`, evidence: [ev] };
      return { situation: bySource(backedCap(cap)), rationale: `Empresa registra ${cap.name}`, evidence: [ev] };
    }
    case 'technical_attestation': {
      // Attestation category is inferred by classifying the capability text with the same dictionary.
      const caps = activeCaps(ctx, 'technical_attestation').filter((c) => {
        const seg = { text: [c.name, c.description, ...c.keywords].join('. '), weight: 1, origin: { type: 'opportunity' as const, field: 'capability' } };
        return ctx.category !== null && classify([seg], ctx.dictionary, []).categories[0]?.category === ctx.category;
      });
      if (!caps.length) return missing(ctx, 'technical_attestation', `Atestado compatível com a categoria ${ctx.category ?? 'não identificada'}`);
      const best = caps.find(backedCap) ?? caps[0]!;
      const ev = registry.fromCompany('capabilities', best.name, backedCap(best));
      const infer = registry.inferred(`Atestado "${best.name}" classificado na mesma categoria do objeto (${ctx.category})`);
      if (p.minPercent !== undefined) return { situation: 'met_declared', rationale: `Há atestado compatível; quantitativo mínimo de ${p.minPercent}% exige conferência humana`, evidence: [ev, infer] };
      return { situation: bySource(backedCap(best)), rationale: `Atestado compatível: ${best.name}`, evidence: [ev, infer] };
    }
    case 'tax_regularity': {
      const sub = String(p.subtype) as TaxSubtype;
      const cert = ctx.certificates.filter((d) => d.kind === 'company_certificate' && d.certificate).find(TAX_MATCH[sub]);
      if (!cert) return unverified(`Certidão (${req.description}) não encontrada no cofre da empresa`, ctx);
      const until = cert.certificate!.validUntil;
      const ev = registry.fromCompany('certificates', `${cert.title}${until ? ` válida até ${until}` : ''}`, backedCert(cert));
      if (until && until < ctx.today) return { situation: 'unverified', rationale: `${cert.title} vencida em ${until} — renovar`, evidence: [ev] };
      return { situation: bySource(backedCert(cert)), rationale: `${cert.title} no cofre`, evidence: [ev] };
    }
    case 'legal_qualification':
      return unverified('Documentos societários não são conferidos automaticamente', ctx);
    case 'financial':
      // Contracts v1 have no structured financial ratios (see handoff request).
      return unverified(`${req.description}: indicadores contábeis não estruturados no cadastro da empresa`, ctx);
    case 'operational_capacity': {
      if (p.onsite) {
        const cover = activeCaps(ctx, 'geographic_coverage');
        if (!cover.length) return missing(ctx, 'geographic_coverage', 'Cobertura geográfica');
        const hit = ctx.uf ? cover.find((c) => c.ufs.includes(ctx.uf as never)) : undefined;
        if (hit) return { situation: bySource(backedCap(hit)), rationale: `Cobertura presencial em ${ctx.uf}`, evidence: [registry.fromCompany('capabilities', `${hit.name} (${hit.ufs.join(', ')})`, backedCap(hit))] };
        return missing(ctx, 'geographic_coverage', `Atendimento presencial em ${ctx.uf ?? 'UF não informada'}`);
      }
      return unverified(`${req.description}: confirmar viabilidade operacional`, ctx);
    }
    case 'participation': {
      if (p.rule === 'no_consortium') return { situation: 'met', rationale: 'Vedação a consórcio não impede participação isolada', evidence: [registry.inferred('Participação isolada não é afetada pela vedação a consórcio')] };
      const size = ctx.company.size;
      const ev = registry.fromCompany('company.size', size, false);
      const smallBusiness = size !== 'DEMAIS';
      if (p.rule === 'me_epp_exclusive')
        return smallBusiness ? { situation: 'met_declared', rationale: `Empresa cadastrada como ${size}`, evidence: [ev] } : { situation: 'not_met', rationale: 'Participação exclusiva ME/EPP e a empresa está cadastrada como DEMAIS', evidence: [ev] };
      return { situation: 'met', rationale: smallBusiness ? 'Pode disputar a cota reservada' : 'Disputa a cota principal (ampla)', evidence: [ev] };
    }
    case 'site_visit':
      return p.mandatory === 'yes' ? unverified('Visita técnica obrigatória: agendar dentro do prazo do edital', ctx) : { situation: 'met', rationale: 'Visita facultativa', evidence: [] };
    case 'sample_poc':
      return unverified('Prova de conceito/amostra: verificar capacidade de entrega no prazo', ctx);
  }
}

export type QualificationScore = FitAssessmentResult['qualification'];

export function assessQualification(requirements: ExtractedRequirement[], ctx: Ctx, weights: Weights): QualificationScore {
  const assessed: AssessedRequirement[] = requirements.map((req, i) => {
    const a = assess(req, ctx);
    const docEvidence = req.passages.map((p) => ctx.registry.fromPassage(p, `Exigência: ${req.description}`));
    return {
      id: `req-${String(i + 1).padStart(3, '0')}`,
      type: req.type,
      description: req.description,
      params: req.params,
      eliminatory: req.eliminatory,
      origin: req.origin,
      situation: a.situation,
      rationale: a.rationale,
      evidence: [...docEvidence, ...a.evidence],
    };
  });
  if (!assessed.length) return { score: null, band: null, requirements: [], eliminatoryImpediments: [] };

  const q = weights.qualification;
  let sum = 0;
  let total = 0;
  for (const r of assessed) {
    sum += q.typeWeight[r.type] * q.situationValue[r.situation];
    total += q.typeWeight[r.type];
  }
  const impediments = assessed.filter((r) => r.eliminatory && r.situation === 'not_met').map((r) => `${r.description}: ${r.rationale}`);
  let score = Math.round((sum / total) * 100);
  if (impediments.length) score = Math.min(score, q.capImpediment);
  return { score, band: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low', requirements: assessed, eliminatoryImpediments: impediments };
}
