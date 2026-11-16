/**
 * match.score (T-305) — pure computation of a MatchScore for Opportunity × SearchProfile.
 *
 * The commercial score is NOT re-implemented here: it is `scoreCommercial` from the fit engine, the
 * single source (CONTRACTS §5). Input is the Opportunity itself (title, object, items); documents are
 * not available at ingestion time. Consequence: for the same opportunity, `fit_assessment` can score the
 * object factor higher once document text adds evidence — see the handoff.
 */
import { matchFactor, type MatchScore, type Opportunity, type OpportunityItem, type SearchProfile } from '../../contracts';
import { classify, opportunitySegments } from '../analysis/fit/classifier';
import { scoreCommercial } from '../analysis/fit/commercial';
import { NETT_DICTIONARY_V1, type Dictionary, type NettCategory } from '../analysis/fit/dictionary';
import { EvidenceRegistry } from '../analysis/fit/evidence';
import { ENGINE_VERSION, PRODUCTION_WEIGHTS, type Weights } from '../analysis/fit/weights';

export type MatchComputation = {
  score: number;
  band: 'high' | 'medium' | 'low';
  primaryCategory: NettCategory | null;
  factors: MatchScore['factors'];
  caps: string[];
  algorithmVersion: string;
};

export type ComputeMatchInput = {
  opportunity: Opportunity;
  items: Pick<OpportunityItem, 'number' | 'description'>[];
  /** null = no profile preferences (neutral region/value/modality); used for category-only summaries. */
  profile: SearchProfile | null;
  now?: Date;
  weights?: Weights;
  dictionary?: Dictionary;
};

export const algorithmVersionOf = (weights: Weights = PRODUCTION_WEIGHTS, dictionary: Dictionary = NETT_DICTIONARY_V1) =>
  `${ENGINE_VERSION}|${weights.version}|${dictionary.version}`;

export function computeMatch({ opportunity, items, profile, now = new Date(), weights = PRODUCTION_WEIGHTS, dictionary = NETT_DICTIONARY_V1 }: ComputeMatchInput): MatchComputation {
  const segments = opportunitySegments(opportunity, items);
  const classification = classify(segments, dictionary, segments, profile?.excludeTerms ?? []);
  const c = scoreCommercial(opportunity, classification, profile, new EvidenceRegistry(), weights, now.getTime());
  return {
    score: c.score,
    band: c.band,
    primaryCategory: c.primaryCategory,
    // The evidence ids are dropped: MatchScore persists only the auditable factors.
    factors: c.factors.map((f) => matchFactor.parse({ key: f.key, label: f.label, points: f.points, max: f.max, detail: f.detail })),
    caps: c.caps,
    algorithmVersion: algorithmVersionOf(weights, dictionary),
  };
}
