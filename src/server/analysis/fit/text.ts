/**
 * Semantic text helpers for the fit assessment.
 * Builds on `normalizar` (src/lib/plataforma/texto.ts, inherited from LicitaFlow) and adds light
 * Portuguese stemming plus order-free proximity matching, so classification does not depend on
 * exact string equality.
 */
import { normalizar } from '../../../lib/plataforma/texto';

export { normalizar as normalize };

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'para', 'com', 'em', 'por', 'um', 'uma',
  'no', 'na', 'nos', 'nas', 'ao', 'aos', 'ou', 'que', 'se', 'sua', 'seu', 'suas', 'seus', 'pela', 'pelo',
]);

const SUFFIXES = ['coes', 'cao', 'mentos', 'mento', 'ancas', 'anca', 'encias', 'encia', 'idades', 'idade', 'ias', 'ia', 'ores', 'or', 'ais', 'al', 'es', 's'];

/** Light stem; two passes keep it stable ("auditorias" → "auditor" → "audit" = "auditores"). */
export function stem(word: string): string {
  let w = word;
  if (/^\d+$/.test(w)) return w;
  for (let pass = 0; pass < 2; pass += 1) {
    const suffix = SUFFIXES.find((s) => w.length - s.length >= 4 && w.endsWith(s));
    if (!suffix) break;
    w = w.slice(0, -suffix.length);
  }
  return w;
}

export function tokens(text: string): string[] {
  return normalizar(text)
    .split(' ')
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(stem);
}

/** True when every token of `expression` appears, in any order, within a window of `window` tokens. */
export function matchesWithin(textTokens: string[], expression: string, window = 8): boolean {
  const target = [...new Set(tokens(expression))];
  if (target.length === 0) return false;
  if (target.length === 1) return textTokens.includes(target[0]!);
  const width = Math.max(window, target.length);
  for (let i = 0; i < textTokens.length; i += 1) {
    if (!target.includes(textTokens[i]!)) continue;
    const slice = new Set(textTokens.slice(i, i + width));
    if (target.every((t) => slice.has(t))) return true;
  }
  return false;
}

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;:!?])\s+|\n{2,}/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Quotable excerpt without breaking words. */
export function clip(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > max * 0.6 ? space : max)}…`;
}

/** "1.234.567,89" | "1,5" | "12345.67" → number. */
export function parseBrNumber(text: string): number | null {
  const clean = text.replace(/[^\d.,]/g, '');
  if (!clean) return null;
  const value = clean.includes(',') ? Number(clean.replace(/\./g, '').replace(',', '.')) : Number(clean);
  return Number.isFinite(value) ? value : null;
}
