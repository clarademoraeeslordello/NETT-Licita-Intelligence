/**
 * Cheap, in-memory pre-filter for match.score. With the partitioned open-proposals sweep (ADR-023) this
 * job fires for every new Opportunity (tens of thousands on the first run), so anything NO active
 * SearchProfile can match must be discarded without loading items, existing scores or classifying.
 *
 * A profile is ELIGIBLE for an opportunity when none of these hard filters excludes it:
 *  - source: `sourceKeys` is empty or includes the opportunity's source;
 *  - UF: `ufs` is empty (national) or includes the opportunity's UF (unknown UF is NOT excluded);
 *  - modality: `modalityCodes` is empty or includes the code (unknown code is NOT excluded);
 *  - value: when the estimate is known, it lies in [minValue, maxValue] (unknown/confidential is NOT excluded);
 *  - terms: at least one `includeTerms` entry matches the text (stemmed, any order within a window).
 * Doubt favours keeping the profile; the score itself still penalizes weak matches.
 * `excludeTerms` are not a discard criterion: they cap the stored score (visible in `caps`).
 */
import type { SearchProfile } from '../../contracts';
import { matchesWithin, tokens } from '../analysis/fit/text';

export type EligibilityReason = 'source' | 'uf' | 'modality' | 'value' | 'terms';

export type EligibilityOpportunity = {
  uf: string | null;
  modalityCode: number | null;
  /** decimal string or null */
  estimatedValue: string | null;
  title: string;
  objectDescription: string;
};

export type EligibilityProfile = Pick<SearchProfile, 'ufs' | 'modalityCodes' | 'minValue' | 'maxValue' | 'sourceKeys' | 'includeTerms'>;

/** Tokenized text, computed once per job and reused for every profile. */
export const textTokens = (...texts: string[]) => tokens(texts.join('. '));

export const termsMatch = (textTokensOf: string[], includeTerms: string[]) => includeTerms.some((t) => matchesWithin(textTokensOf, t));

/** Everything except the terms test (which may need item text). Returns the first failing reason or null. */
export function hardFilter(opp: EligibilityOpportunity, sourceKey: string | null, p: EligibilityProfile): EligibilityReason | null {
  if (p.sourceKeys.length > 0 && !(sourceKey && p.sourceKeys.includes(sourceKey))) return 'source';
  if (p.ufs.length > 0 && opp.uf !== null && !p.ufs.includes(opp.uf as never)) return 'uf';
  if (p.modalityCodes.length > 0 && opp.modalityCode !== null && !p.modalityCodes.includes(opp.modalityCode)) return 'modality';
  if (opp.estimatedValue !== null) {
    const v = Number(opp.estimatedValue);
    if (p.minValue !== null && v < Number(p.minValue)) return 'value';
    if (p.maxValue !== null && v > Number(p.maxValue)) return 'value';
  }
  return null;
}
