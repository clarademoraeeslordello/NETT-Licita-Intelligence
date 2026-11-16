/**
 * Filtro de fonte por SearchProfile (CONTRACTS §2: SearchProfile é lido pelo agente 02).
 * Decide apenas se vale ENRIQUECER o registro (itens + documentos) — não é aderência (agente 03).
 * Função pura sobre a oportunidade normalizada.
 */
import Decimal from './decimal';
import type { OpportunityUpsert } from './connector';

export type ProfileFilter = {
  includeTerms: string[];
  excludeTerms: string[];
  ufs: string[];
  modalityCodes: number[];
  minValue: string | null;
  maxValue: string | null;
  sourceKeys: string[];
};

export const normalizeText = (t: string) =>
  ` ${t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

/** Termo casa como palavra/expressão inteira, sem acento nem caixa. */
export const containsTerm = (haystack: string, term: string) => {
  const t = normalizeText(term).trim();
  return t.length > 0 && haystack.includes(` ${t} `);
};

export function matchesProfile(opp: OpportunityUpsert, sourceKey: string, p: ProfileFilter): boolean {
  if (p.sourceKeys.length && !p.sourceKeys.includes(sourceKey)) return false;
  if (p.ufs.length && (!opp.uf || !p.ufs.includes(opp.uf))) return false;
  if (p.modalityCodes.length && (opp.modalityCode === null || !p.modalityCodes.includes(opp.modalityCode))) return false;
  // Valor desconhecido/sigiloso não exclui: quem decide é a análise humana.
  if (opp.estimatedValue !== null) {
    if (p.minValue !== null && Decimal.lt(opp.estimatedValue, p.minValue)) return false;
    if (p.maxValue !== null && Decimal.gt(opp.estimatedValue, p.maxValue)) return false;
  }
  const texto = normalizeText(`${opp.title} ${opp.objectDescription}`);
  if (p.excludeTerms.some((t) => containsTerm(texto, t))) return false;
  return p.includeTerms.some((t) => containsTerm(texto, t));
}

export const matchesAny = (opp: OpportunityUpsert, sourceKey: string, profiles: ProfileFilter[]) =>
  profiles.some((p) => matchesProfile(opp, sourceKey, p));
