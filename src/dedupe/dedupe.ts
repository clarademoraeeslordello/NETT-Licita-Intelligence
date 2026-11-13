/**
 * Deduplicação de oportunidades.
 *
 * 1. Chave canônica forte: número de controle PNCP (presente no PNCP e no Compras.gov).
 * 2. Sem número de controle: CNPJ do órgão + processo normalizado + ano.
 * 3. Último recurso: fonte + id externo.
 * Além da chave, `similaridadeObjeto` sinaliza *possíveis* duplicatas (mesmo órgão, objeto
 * muito parecido, chaves diferentes) para revisão — nunca mescla automaticamente.
 */
import { createHash } from 'node:crypto';
import type { OportunidadeColetada } from '../contrato/normalizada.js';
import { normalizarTexto } from '../dicionario/dicionario.js';

export const normalizarProcesso = (processo: string) => processo.replace(/[^0-9a-z]/gi, '').toUpperCase();

export function chaveCanonica(r: Pick<OportunidadeColetada, 'numeroControlePncp' | 'orgaoCnpj' | 'processo' | 'ano' | 'fonte' | 'idExterno'>): string {
  if (r.numeroControlePncp) return `pncp:${r.numeroControlePncp.trim()}`;
  if (r.orgaoCnpj && r.processo) return `proc:${r.orgaoCnpj}:${normalizarProcesso(r.processo)}:${r.ano ?? ''}`;
  return `fonte:${r.fonte}:${r.idExterno}`;
}

const PALAVRAS_VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'para', 'com', 'em', 'no', 'na', 'por', 'ao', 'as', 'os']);

export function tokens(texto: string): Set<string> {
  return new Set(
    normalizarTexto(texto)
      .split(' ')
      .filter((t) => t.length > 2 && !PALAVRAS_VAZIAS.has(t)),
  );
}

/** Índice de Jaccard entre os conjuntos de palavras dos objetos (0..1). */
export function similaridadeObjeto(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let comum = 0;
  for (const t of ta) if (tb.has(t)) comum += 1;
  return comum / (ta.size + tb.size - comum);
}

export const LIMIAR_POSSIVEL_DUPLICATA = 0.8;

export function hashEstavel(valor: unknown): string {
  const ordenar = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordenar)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, w]) => [k, ordenar(w)]))
        : v;
  return createHash('sha256').update(JSON.stringify(ordenar(valor))).digest('hex');
}
