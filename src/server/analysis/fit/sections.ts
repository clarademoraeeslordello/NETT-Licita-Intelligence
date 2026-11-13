/** Splits public tender documents into traceable passages (document, page, section). */
import type { Document } from '../../../contracts';
import { normalize, sentences } from './text';

export type SectionKind = 'object' | 'specification' | 'qualification' | 'participation' | 'obligations' | 'penalties' | 'payment' | 'proposal' | 'other';
export type DocRole = 'tender_notice' | 'reference_term' | 'annex' | 'other';

export type PagedText = { page: number; text: string };
export type FitDocument = { document: Document; pages: PagedText[] };

export type Passage = {
  documentId: string;
  documentTitle: string;
  role: DocRole;
  page: number;
  section: string | null;
  sectionKind: SectionKind;
  text: string;
};

export function docRole(d: Document): DocRole {
  return d.kind === 'tender_notice' || d.kind === 'reference_term' || d.kind === 'annex' ? d.kind : 'other';
}

const TITLE_PREFIX = /^(cl[aá]usula|cap[ií]tulo|se[cç][aã]o|t[ií]tulo|anexo)\b/i;
const NUMBERING = /^(\d+(\.\d+)*)\s*[.)\-–—]?\s+/;

function upperRatio(line: string): number {
  const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 4) return 0;
  return letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length;
}

export function isHeading(line: string): boolean {
  const l = line.trim();
  if (l.length < 4 || l.length > 140) return false;
  if (/[.;:,]$/.test(l) && !TITLE_PREFIX.test(l)) return false;
  if (TITLE_PREFIX.test(l) && upperRatio(l) > 0.5) return true;
  return upperRatio(l.replace(NUMBERING, '')) >= 0.75;
}

export function classifySection(title: string): SectionKind {
  const t = normalize(title);
  if (/\bobjeto\b/.test(t)) return 'object';
  if (/habilita|qualificacao|regularidade|documentos de|documentacao/.test(t)) return 'qualification';
  if (/especifica|descricao da solucao|requisitos|escopo|detalhamento|termo de referencia/.test(t)) return 'specification';
  if (/participa|condicoes para|consorcio|microempresa/.test(t)) return 'participation';
  if (/obrigac|responsabilidade|lgpd|protecao de dados|sigilo/.test(t)) return 'obligations';
  if (/sanc|penalidade|infrac|multa/.test(t)) return 'penalties';
  if (/pagamento|faturamento|reajuste/.test(t)) return 'payment';
  if (/proposta|lances|julgamento/.test(t)) return 'proposal';
  return 'other';
}

const ITEM_START = /^(\d+(\.\d+)+\.?|[a-z]\)|[ivx]+\)|[-•])\s+/i;

export function segment(documents: FitDocument[]): Passage[] {
  const out: Passage[] = [];
  for (const { document, pages } of documents) {
    const role = docRole(document);
    let section: string | null = null;
    let sectionKind: SectionKind = role === 'reference_term' ? 'specification' : 'other';
    for (const page of pages) {
      let paragraph: string[] = [];
      const flush = () => {
        const text = paragraph.join(' ').trim();
        paragraph = [];
        if (!text) return;
        for (const s of sentences(text)) out.push({ documentId: document.id, documentTitle: document.title, role, page: page.page, section, sectionKind, text: s });
      };
      for (const raw of page.text.split('\n')) {
        const line = raw.trim();
        if (!line) {
          flush();
          continue;
        }
        if (isHeading(line)) {
          flush();
          section = line.replace(/\s+/g, ' ');
          const kind = classifySection(line);
          // A neutral heading inside a reference term keeps the specification context.
          sectionKind = kind === 'other' && role === 'reference_term' ? 'specification' : kind;
          continue;
        }
        if (ITEM_START.test(line)) flush();
        paragraph.push(line);
      }
      flush();
    }
  }
  return out;
}
