/**
 * Tender documents are UNTRUSTED content. The rules engine never executes anything written in them;
 * this module only detects embedded instructions so they are reported as alerts/risks and excluded
 * from scoring. On the LLM path the text is delimited as data (see prompts.ts).
 */
import type { Passage } from './sections';
import { clip } from './text';

const PATTERNS: RegExp[] = [
  /ignore\s+(todas\s+)?(as\s+)?(instru[cç][oõ]es|regras|orienta[cç][oõ]es)/i,
  /desconsidere\s+(as\s+|todas\s+as\s+)?(instru|regras|orienta)/i,
  /ignore\s+(all\s+|any\s+)?(previous|prior|above)?\s*instructions/i,
  /\b(system|developer)\s*prompt\b|prompt\s+do\s+sistema/i,
  /voc[eê]\s+(agora\s+)?(é|e|deve\s+agir\s+como)\s+(um|uma)\s+(assistente|modelo|ia)\b/i,
  /\b(aja|atue)\s+como\s+(um|uma)?\s*(assistente|ia|modelo)/i,
  /<\/?\s*(system|assistant|instructions?)\s*>/i,
  /^\s*(assistant|system)\s*:/im,
  /(atribua|defina|retorne|d[eê])\s+(a\s+)?(nota|pontua[cç][aã]o|score)\s+(m[aá]xima|100|10)/i,
  /recomend(e|ar)\s+(a\s+)?participa[cç][aã]o\s+(imediata|obrigat[oó]ria)/i,
  /(classifique|marque)\s+(este|esta|o)\s+(edital|licita[cç][aã]o|documento)\s+como\s+(apto|aprovado|participar)/i,
];

export type InjectionAlert = { kind: 'embedded_instruction'; documentId: string; page: number; excerpt: string };

export function hasEmbeddedInstruction(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

export function detectEmbeddedInstructions(passages: Passage[]): InjectionAlert[] {
  const seen = new Set<string>();
  const alerts: InjectionAlert[] = [];
  for (const p of passages) {
    if (!hasEmbeddedInstruction(p.text)) continue;
    const key = `${p.documentId}:${p.page}:${p.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    alerts.push({ kind: 'embedded_instruction', documentId: p.documentId, page: p.page, excerpt: clip(p.text, 200) });
  }
  return alerts;
}
