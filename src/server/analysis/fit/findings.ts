/** Contract findings relevant to risk (fines, guarantees, subcontracting, cited values). Literal only. */
import type { Passage } from './sections';
import { parseBrNumber } from './text';

export type Finding =
  | { type: 'fine'; percent: number; passage: Passage }
  | { type: 'performance_guarantee'; percent: number; passage: Passage }
  | { type: 'no_subcontracting'; passage: Passage }
  | { type: 'estimated_value'; value: number; passage: Passage };

export function extractFindings(passages: Passage[]): Finding[] {
  const out: Finding[] = [];
  for (const p of passages) {
    const fine = p.text.match(/multa[^.;]{0,80}?(\d{1,2}(?:[.,]\d+)?)\s*%/i);
    const finePct = fine ? parseBrNumber(fine[1]!) : null;
    if (finePct !== null) out.push({ type: 'fine', percent: finePct, passage: p });
    const guarantee = p.text.match(/garantia\s+(?:contratual|de\s+execu[cç][aã]o)[^.;]{0,80}?(\d{1,2}(?:[.,]\d+)?)\s*%/i);
    const guaranteePct = guarantee ? parseBrNumber(guarantee[1]!) : null;
    if (guaranteePct !== null) out.push({ type: 'performance_guarantee', percent: guaranteePct, passage: p });
    if (/(vedada|n[aã]o\s+ser[aá]\s+(admitida|permitida))\s+a\s+subcontrata[cç][aã]o/i.test(p.text)) out.push({ type: 'no_subcontracting', passage: p });
    const value = p.text.match(/valor\s+(?:total\s+|global\s+|m[aá]ximo\s+)?(?:estimado|global|m[aá]ximo\s+aceit[aá]vel)[^.;]{0,60}?R\$\s*([\d.]+,\d{2})/i);
    const v = value ? parseBrNumber(value[1]!) : null;
    if (v !== null) out.push({ type: 'estimated_value', value: v, passage: p });
  }
  return out;
}
