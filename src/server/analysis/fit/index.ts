export { runFitAssessment, toAIAnalysis, validateInput, computeInputHash, InvalidFitInput, type FitAssessmentInput, type FitAssessmentOptions } from './engine';
export { fitAssessmentResult, FIT_RESULT_SCHEMA_VERSION, type FitAssessmentResult, type Decision } from './result';
export { NETT_DICTIONARY_V1, nettCategory, type Dictionary, type NettCategory } from './dictionary';
export { WEIGHTS_V1, PRODUCTION_WEIGHTS, ENGINE_VERSION, type Weights } from './weights';
export { HUMAN_DECISION_NOTICE } from './opinion';
export { compareWithReviews, divergenceReport, type Divergence, type DivergenceReport } from './review';
export { backtest, type BacktestCase } from './backtest';
export { inheritedClientModel, FIT_PROMPT_VERSION, type JsonModel } from './llm';
export type { FitDocument, PagedText } from './sections';
