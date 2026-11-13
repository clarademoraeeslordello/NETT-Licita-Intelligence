/**
 * Leitura e formatação de evidências — MÓDULO SEM DEPENDÊNCIAS.
 *
 * Fica separado de `schema.ts` de propósito: `schema.ts` importa Zod e monta os
 * schemas em tempo de módulo, então qualquer componente cliente que importasse
 * os helpers de lá arrastaria o Zod inteiro para o bundle do browser.
 *
 * Aqui só existe lógica pura de leitura — seguro para uso no cliente.
 */

export const NOT_FOUND_LABEL = 'Não identificado no documento.';

/** Formato mínimo aceito por `evidenceText` (compatível com `Evidence`). */
export type EvidenceLike = {
  status?: 'found' | 'inferred' | 'not_found' | string;
  value?: string | number | null;
  quote?: string | null;
  source?: string | null;
  reason?: string | null;
};

const SENTINELAS = /^(n\/?a|nao informado|não informado|null|undefined|-{1,})$/i;

/** Texto legível de uma evidência, com o rótulo padrão para ausência. */
export function evidenceText(evidence: EvidenceLike | undefined | null): string {
  if (!evidence) return NOT_FOUND_LABEL;
  if (evidence.status === 'not_found') return NOT_FOUND_LABEL;
  const raw = evidence.value;
  if (raw === null || raw === undefined) return NOT_FOUND_LABEL;
  const text = String(raw).trim();
  if (!text || SENTINELAS.test(text)) return NOT_FOUND_LABEL;
  return text;
}

export function isNotFound(evidence: EvidenceLike | undefined | null): boolean {
  return evidenceText(evidence) === NOT_FOUND_LABEL;
}

/** Quantidade de evidências preenchidas numa lista. */
export function countFound(evidences: Array<EvidenceLike | undefined | null>): number {
  return evidences.filter((evidence) => !isNotFound(evidence)).length;
}
