/**
 * Rule-based extraction of qualification/participation requirements (map-reduce):
 *  - map: each passage is evaluated on its own;
 *  - reduce: equivalent requirements (same key) are merged, keeping source passages and the most
 *    demanding parameter.
 * Only requirements backed by a literal passage are produced; nothing is presumed.
 */
import type { RequirementType } from './result';
import type { Passage } from './sections';
import { parseBrNumber } from './text';

export type ExtractedRequirement = {
  key: string;
  type: RequirementType;
  description: string;
  params: Record<string, string | number>;
  eliminatory: boolean;
  origin: 'rules' | 'llm';
  passages: Passage[];
};

type Draft = Omit<ExtractedRequirement, 'passages' | 'origin'>;
type Rule = (p: Passage) => Draft[];

const DESIRABLE = /desej[aá]ve(l|is)|preferencialmente|ser[aá]\s+pontuad|para\s+fins\s+de\s+pontua|crit[eé]rio\s+de\s+pontua/i;
const DEMAND =
  /(dever[aá]|devem|dever[aã]o)\s+(apresentar|possuir|comprovar|deter|dispor)|apresenta[cç][aã]o\s+d[eo]|comprova[cç][aã]o\s+d[eo]|comprovar|exig[eê]-se|exigid[oa]|possu(ir|a|am|em)\b|ser[aá]\s+exigid|certificad[oa]\s+(v[aá]lid|vigente)|prova\s+de/i;
const PROFESSIONAL_SUBJECT =
  /profissiona(l|is)|respons[aá]ve(l|is)\s+t[eé]cnic|equipe\s+t[eé]cnica|coordenador|gerente\s+de\s+projeto|consultor(es)?|auditor(es)?\s+l[ií]der|lead\s+auditor|lead\s+implementer|analista/i;
const PROFESSIONAL_CERT =
  /\b(CISSP|CISM|CISA|CRISC|CEH|OSCP|PMP|ITIL(?:\s*v?\d)?|COBIT|CDPO(?:\/BR)?|EXIN\s+(?:PDPF|PDPP|ISFS|ISMP)|PDPF|PDPP|CCNA|CCNP|LPIC-?\d?|Scrum\s+Master|CSM|PSM|Lead\s+Auditor(?:\s+ISO\s*\d{4,5})?|Auditor\s+L[ií]der(?:\s+ISO\s*\d{4,5})?|Lead\s+Implementer(?:\s+ISO\s*\d{4,5})?|PL-300|DP-203|AWS\s+Certified[\w\s-]{0,30}|Azure\s+[\w-]+)\b/gi;
const COMPANY_STANDARD = /\b(?:ABNT\s+)?(?:NBR\s+)?ISO(?:\s*\/\s*IEC)?\s*(\d{4,5})(?::\d{4})?/gi;

const demands = (p: Passage) => p.sectionKind !== 'object' && DEMAND.test(p.text);
const eliminatory = (p: Passage) => !DESIRABLE.test(p.text);

const certifications: Rule = (p) => {
  if (!demands(p)) return [];
  const out: Draft[] = [];
  const professional = PROFESSIONAL_SUBJECT.test(p.text);
  for (const m of p.text.matchAll(PROFESSIONAL_CERT)) {
    const cert = m[1]!.replace(/\s+/g, ' ').trim();
    out.push({ key: `prof:${cert.toUpperCase()}`, type: 'professional', description: `Profissional com certificação ${cert}`, params: { certification: cert }, eliminatory: eliminatory(p) });
  }
  // A standard cited as the service scope ("implantar a ISO 27001") is not a bidder certification.
  const bidderCert = /certifica(do|d[ao]s?|[cç][aã]o)/i.test(p.text) && (p.sectionKind === 'qualification' || /licitante|proponente|empresa|contratada|fornecedor/i.test(p.text));
  if (!professional && bidderCert) {
    for (const m of p.text.matchAll(COMPANY_STANDARD)) {
      const standard = `ISO ${m[1]}`;
      out.push({ key: `cert:${standard}`, type: 'company_certification', description: `Certificação ${standard} da licitante`, params: { standard }, eliminatory: eliminatory(p) });
    }
    const cmmi = p.text.match(/CMMI[^.;]{0,40}?n[ií]vel\s*(\d)/i);
    if (cmmi) out.push({ key: 'cert:CMMI', type: 'company_certification', description: `CMMI nível ${cmmi[1]}`, params: { standard: 'CMMI', level: Number(cmmi[1]) }, eliminatory: eliminatory(p) });
    const mps = p.text.match(/MPS\.?\s*BR[^.;]{0,30}?n[ií]vel\s*([A-G])\b/i);
    if (mps) out.push({ key: 'cert:MPS.BR', type: 'company_certification', description: `MPS.BR nível ${mps[1]}`, params: { standard: 'MPS.BR', level: mps[1]! }, eliminatory: eliminatory(p) });
  } else if (professional && !out.length) {
    const degree = p.text.match(/(gradua[cç][aã]o|n[ií]vel\s+superior|forma[cç][aã]o\s+superior|p[oó]s-gradua[cç][aã]o)[^.;]{0,80}/i);
    if (degree) out.push({ key: `prof:degree:${degree[0].slice(0, 40).toLowerCase()}`, type: 'professional', description: `Profissional com ${degree[0].trim()}`, params: { degree: degree[0].trim() }, eliminatory: eliminatory(p) });
  }
  return out;
};

const attestation: Rule = (p) => {
  if (p.sectionKind === 'object') return [];
  if (!/atestados?\s+(de\s+)?capacidade\s+t[eé]cnica|atestados?\s+t[eé]cnicos?|certid[aã]o\s+de\s+acervo\s+t[eé]cnico|\bCAT\b/i.test(p.text)) return [];
  const params: Record<string, string | number> = {};
  const pct = p.text.match(/(?:m[ií]nimo|pelo\s+menos|no\s+m[ií]nimo|correspondente\s+a|equivalente\s+a)[^.;%]{0,40}?(\d{1,3})\s*%/i);
  if (pct) params.minPercent = Number(pct[1]);
  if (/t[eé]cnico[\s-]operacional/i.test(p.text)) params.modality = 'técnico-operacional';
  else if (/t[eé]cnico[\s-]profissional|acervo/i.test(p.text)) params.modality = 'técnico-profissional';
  const description = `Atestado de capacidade técnica${params.modality ? ` (${params.modality})` : ''}${params.minPercent ? ` com quantitativo mínimo de ${params.minPercent}%` : ''}`;
  return [{ key: 'attestation', type: 'technical_attestation', description, params, eliminatory: eliminatory(p) }];
};

export const TAX_SUBTYPES = ['federal', 'fgts', 'labor', 'state', 'municipal', 'sicaf', 'bankruptcy'] as const;
export type TaxSubtype = (typeof TAX_SUBTYPES)[number];

const TAX: { sub: TaxSubtype; label: string; pattern: RegExp }[] = [
  { sub: 'federal', label: 'Regularidade fiscal federal (Receita Federal/PGFN)', pattern: /Receita\s+Federal|D[ií]vida\s+Ativa\s+da\s+Uni[aã]o|tributos\s+federais|Fazenda\s+(P[uú]blica\s+)?Federal/i },
  { sub: 'fgts', label: 'Regularidade perante o FGTS (CRF)', pattern: /\bFGTS\b|\bCRF\b/ },
  { sub: 'labor', label: 'Regularidade trabalhista (CNDT)', pattern: /\bCNDT\b|d[eé]bitos\s+trabalhistas/i },
  { sub: 'state', label: 'Regularidade fiscal estadual', pattern: /Fazenda\s+(P[uú]blica\s+)?Estadual|tributos\s+estaduais/i },
  { sub: 'municipal', label: 'Regularidade fiscal municipal', pattern: /Fazenda\s+(P[uú]blica\s+)?Municipal|tributos\s+municipais/i },
  { sub: 'sicaf', label: 'Cadastro no SICAF', pattern: /\bSICAF\b/ },
  { sub: 'bankruptcy', label: 'Certidão negativa de falência/recuperação judicial', pattern: /fal[eê]ncia|recupera[cç][aã]o\s+judicial/i },
];

const taxRegularity: Rule = (p) => {
  if (p.sectionKind !== 'qualification' && !/prova\s+de|certid[aã]o|comprova/i.test(p.text)) return [];
  return TAX.filter((t) => t.pattern.test(p.text)).map((t) => ({ key: `tax:${t.sub}`, type: 'tax_regularity' as const, description: t.label, params: { subtype: t.sub }, eliminatory: true }));
};

const legal: Rule = (p) =>
  p.sectionKind !== 'object' && /ato\s+constitutivo|contrato\s+social|estatuto\s+social|registro\s+comercial/i.test(p.text)
    ? [{ key: 'legal', type: 'legal_qualification', description: 'Habilitação jurídica (ato constitutivo/registro)', params: {}, eliminatory: true }]
    : [];

const RATIOS = [
  { id: 'LG', label: 'Liquidez Geral', pattern: /(?:\bLG\b|liquidez\s+geral)/i },
  { id: 'SG', label: 'Solvência Geral', pattern: /(?:\bSG\b|solv[eê]ncia\s+geral)/i },
  { id: 'LC', label: 'Liquidez Corrente', pattern: /(?:\bLC\b|liquidez\s+corrente)/i },
];
const COMPARATOR = /(?:igual\s+ou\s+superior\s+a|maior(?:es)?\s+(?:ou\s+igua(?:l|is)\s+)?(?:que|a)|superior(?:es)?\s+a|n[aã]o\s+inferior(?:es)?\s+a|>=|≥|>)\s*(\d+(?:[.,]\d+)?)/i;

const financial: Rule = (p) => {
  const out: Draft[] = [];
  for (const r of RATIOS) {
    const m = p.text.match(new RegExp(`${r.pattern.source}[^.;]{0,80}?${COMPARATOR.source}`, 'i'));
    const min = m ? parseBrNumber(m[1]!) : null;
    if (min !== null) out.push({ key: `fin:${r.id}`, type: 'financial', description: `${r.label} ≥ ${min}`, params: { indicator: r.id, min }, eliminatory: true });
  }
  const equity = p.text.match(/patrim[oô]nio\s+l[ií]quido[^.;]{0,60}?(\d{1,2}(?:[.,]\d+)?)\s*%/i);
  if (equity) out.push({ key: 'fin:EQUITY%', type: 'financial', description: `Patrimônio líquido mínimo de ${equity[1]}% do valor estimado`, params: { indicator: 'EQUITY_PERCENT', min: parseBrNumber(equity[1]!) ?? 0 }, eliminatory: true });
  if (p.sectionKind !== 'object' && /balan[cç]o\s+patrimonial/i.test(p.text))
    out.push({ key: 'fin:balance', type: 'financial', description: 'Balanço patrimonial e demonstrações contábeis', params: { indicator: 'BALANCE_SHEET' }, eliminatory: true });
  return out;
};

const operational: Rule = (p) => {
  const out: Draft[] = [];
  if (/24\s*(x|por|\/)\s*7|24\s*horas\s+por\s+dia/i.test(p.text)) out.push({ key: 'ops:24x7', type: 'operational_capacity', description: 'Atendimento em regime 24x7', params: { regime: '24x7' }, eliminatory: false });
  if (/(atendimento|suporte|equipe|t[eé]cnico)\s+presencia(l|is)|escrit[oó]rio\s+(local|no\s+munic[ií]pio|na\s+cidade|no\s+estado)|sede\s+ou\s+filial/i.test(p.text))
    out.push({ key: 'ops:onsite', type: 'operational_capacity', description: 'Atendimento presencial/estrutura local', params: { onsite: 'yes' }, eliminatory: false });
  const delivery = p.text.match(/prazo\s+(?:m[aá]ximo\s+)?(?:de\s+)?entrega[^.;]{0,50}?(\d{1,3})\s*(?:\([^)]{0,30}\)\s*)?dias/i);
  if (delivery) out.push({ key: 'ops:delivery', type: 'operational_capacity', description: `Prazo de entrega de ${delivery[1]} dias`, params: { deliveryDays: Number(delivery[1]) }, eliminatory: false });
  return out;
};

const participation: Rule = (p) => {
  const out: Draft[] = [];
  if (/exclusiv[ao]s?\s+(?:para\s+|a\s+|[àa]s?\s+)?(?:a\s+)?(?:participa[cç][aã]o\s+de\s+)?(microempresas|\bME\b|\bMEs\b)|participa[cç][aã]o\s+exclusiva\s+de\s+(microempresas|\bME\b)/i.test(p.text))
    out.push({ key: 'part:me_epp_exclusive', type: 'participation', description: 'Participação exclusiva para ME/EPP', params: { rule: 'me_epp_exclusive' }, eliminatory: true });
  if (/cota\s+reservada/i.test(p.text)) out.push({ key: 'part:reserved_quota', type: 'participation', description: 'Cota reservada para ME/EPP', params: { rule: 'reserved_quota' }, eliminatory: false });
  if (/vedad[ao]\s+a\s+participa[cç][aã]o[^.;]{0,60}cons[oó]rcio|n[aã]o\s+ser[aá]\s+admitida\s+a\s+participa[cç][aã]o[^.;]{0,60}cons[oó]rcio/i.test(p.text))
    out.push({ key: 'part:no_consortium', type: 'participation', description: 'Vedada a participação em consórcio', params: { rule: 'no_consortium' }, eliminatory: false });
  return out;
};

const visitAndSample: Rule = (p) => {
  const out: Draft[] = [];
  if (/visita\s+t[eé]cnica/i.test(p.text)) {
    const mandatory = /obrigat[oó]ri/i.test(p.text) && !/facultativ/i.test(p.text);
    out.push({ key: 'visit', type: 'site_visit', description: mandatory ? 'Visita técnica obrigatória' : 'Visita técnica facultativa', params: { mandatory: mandatory ? 'yes' : 'no' }, eliminatory: mandatory });
  }
  if (/prova\s+de\s+conceito|\bPoC\b|apresenta[cç][aã]o\s+de\s+amostras?/i.test(p.text))
    out.push({ key: 'poc', type: 'sample_poc', description: 'Prova de conceito / amostra', params: {}, eliminatory: true });
  return out;
};

const RULES: Rule[] = [certifications, attestation, taxRegularity, legal, financial, operational, participation, visitAndSample];

export function mapPassage(p: Passage): ExtractedRequirement[] {
  return RULES.flatMap((rule) => rule(p)).map((r) => ({ ...r, origin: 'rules' as const, passages: [p] }));
}

export function reduceRequirements(list: ExtractedRequirement[]): ExtractedRequirement[] {
  const byKey = new Map<string, ExtractedRequirement>();
  for (const r of list) {
    const current = byKey.get(r.key);
    if (!current) {
      byKey.set(r.key, { ...r, params: { ...r.params }, passages: [...r.passages] });
      continue;
    }
    for (const [k, v] of Object.entries(r.params)) {
      const old = current.params[k];
      if (old === undefined || (typeof v === 'number' && typeof old === 'number' && v > old)) current.params[k] = v;
    }
    if (r.description.length > current.description.length) current.description = r.description;
    current.eliminatory = current.eliminatory || r.eliminatory;
    if (r.origin === 'rules') current.origin = 'rules';
    for (const p of r.passages) {
      if (current.passages.length < 3 && !current.passages.some((x) => x.documentId === p.documentId && x.page === p.page && x.text === p.text)) current.passages.push(p);
    }
  }
  return [...byKey.values()];
}

export function extractRequirements(passages: Passage[]): ExtractedRequirement[] {
  return reduceRequirements(passages.flatMap(mapPassage));
}
