/**
 * Versioned score weights and thresholds.
 * A published version is never edited. Evolution = new constant (e.g. WEIGHTS_V2) + backtest against
 * human reviews (`backtest.ts`) + human approval + explicit switch of PRODUCTION_WEIGHTS in a commit.
 * The engine never changes weights automatically.
 */
import type { RequirementType } from './result';

export type Weights = {
  version: string;
  commercial: { object: number; region: number; value: number; deadline: number; modality: number };
  thresholds: { categoryFit: number; capNoCategory: number; capExcluded: number; capCancelled: number };
  qualification: {
    typeWeight: Record<RequirementType, number>;
    situationValue: { met: number; met_declared: number; unverified: number; not_met: number };
    capImpediment: number;
  };
  recommendation: { participateCommercialMin: number; participateQualificationMin: number; discardCommercialMax: number };
};

export const WEIGHTS_V1: Readonly<Weights> = Object.freeze({
  version: 'weights-1.0.0',
  commercial: { object: 60, region: 10, value: 10, deadline: 10, modality: 10 },
  thresholds: { categoryFit: 35, capNoCategory: 30, capExcluded: 10, capCancelled: 5 },
  qualification: {
    typeWeight: {
      company_certification: 3,
      technical_attestation: 3,
      professional: 2,
      financial: 2,
      participation: 2,
      tax_regularity: 1,
      legal_qualification: 0.5,
      operational_capacity: 1,
      site_visit: 1,
      sample_poc: 1,
    },
    situationValue: { met: 1, met_declared: 0.7, unverified: 0.4, not_met: 0 },
    capImpediment: 20,
  },
  recommendation: { participateCommercialMin: 65, participateQualificationMin: 60, discardCommercialMax: 35 },
});

export const PRODUCTION_WEIGHTS = WEIGHTS_V1;

export const ENGINE_VERSION = 'fit-engine-1.0.0';
