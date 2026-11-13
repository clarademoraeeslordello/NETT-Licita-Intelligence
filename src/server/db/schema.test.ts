/**
 * Garante que o schema Drizzle não diverge dos contratos (campos com o mesmo nome, sem sobras).
 * Executar: npm run test:contracts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import * as c from '../../contracts';
import * as s from './schema';

const pairs: Array<[string, PgTable, z.ZodObject]> = [
  ['companies', s.companies, c.company],
  ['user_accounts', s.userAccounts, c.userAccount],
  ['memberships', s.memberships, c.membership],
  ['sources', s.sources, c.source],
  ['source_records', s.sourceRecords, c.sourceRecord],
  ['opportunities', s.opportunities, c.opportunity],
  ['opportunity_items', s.opportunityItems, c.opportunityItem],
  ['documents', s.documents, c.document],
  ['ai_analyses', s.aiAnalyses, c.aiAnalysis],
  ['match_scores', s.matchScores, c.matchScore],
  ['human_reviews', s.humanReviews, c.humanReview],
  ['company_capabilities', s.companyCapabilities, c.companyCapability],
  ['search_profiles', s.searchProfiles, c.searchProfile],
  ['opportunity_trackings', s.opportunityTrackings, c.opportunityTracking],
  ['consultant_metrics', s.consultantMetrics, c.consultantMetric],
];

for (const [name, table, contract] of pairs) {
  test(`${name}: colunas = campos do contrato`, () => {
    const cols = Object.keys(getTableColumns(table)).sort();
    const fields = Object.keys(contract.shape).sort();
    assert.deepEqual(cols, fields);
  });
}

test('enums do banco vêm dos contratos', () => {
  assert.deepEqual(s.opportunityStatusEnum.enumValues, c.opportunityStatus.options);
  assert.deepEqual(s.pipelineStageEnum.enumValues, c.pipelineStage.options);
  assert.deepEqual(s.trackingOutcomeEnum.enumValues, c.opportunityTracking.shape.outcome.unwrap().options);
  assert.deepEqual(s.confidenceEnum.enumValues, c.aiAnalysis.shape.confidence.unwrap().options);
});
