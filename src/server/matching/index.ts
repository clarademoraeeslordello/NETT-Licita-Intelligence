export { computeMatch, algorithmVersionOf, type MatchComputation, type ComputeMatchInput } from './score';
export { hardFilter, termsMatch, textTokens, type EligibilityReason } from './eligibility';
export { scoreOpportunity, getMatchSummaries, toOpportunity, toSearchProfile, MAX_SCORE_AGE_MS, MAX_SUMMARY_IDS, UNPERSISTED_CAPS, type MatchSummary, type ScoreRun } from './service';
