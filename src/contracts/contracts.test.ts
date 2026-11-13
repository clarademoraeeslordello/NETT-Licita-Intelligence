/**
 * Testes dos contratos canônicos. Executar: `npx tsx --test src/contracts/contracts.test.ts`
 * (migra para o runner padrão definido em ADR-012 quando T-005 for concluída).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aiAnalysis,
  decimal,
  document,
  humanReview,
  jobs,
  opportunity,
  searchProfile,
  type JobName,
} from './index';

const id = '0190f5e2-7c1a-7cc3-9d2b-3f4a5b6c7d8e';
const now = '2026-11-13T12:00:00-03:00';
const hash = 'a'.repeat(64);

test('decimal rejeita número com ponto flutuante como string inválida', () => {
  assert.equal(decimal.safeParse('1234.5678').success, true);
  assert.equal(decimal.safeParse('1.23456').success, false);
  assert.equal(decimal.safeParse('1e5').success, false);
});

test('opportunity exige canonicalKey prefixada pela fonte', () => {
  const base = {
    id, canonicalKey: 'pncp:00394460000141-2026-15', primarySourceId: id, title: 't', objectDescription: 'o',
    agencyName: 'a', agencyCnpj: '00394460000141', agencyUnit: null, municipality: null, uf: 'RN', sphere: 'municipal',
    modalityCode: 6, modalityName: 'Pregão', disputeMode: null, legalBasis: null, processNumber: null,
    status: 'receiving_proposals', publishedAt: now, proposalsOpenAt: now, proposalsCloseAt: now, sessionAt: null,
    estimatedValue: '1000.00', awardedValue: null, confidentialBudget: false, priceRegistration: false,
    meEppBenefit: 'unknown', url: 'https://pncp.gov.br/app/editais/x', contentHash: hash,
    firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
  };
  assert.equal(opportunity.safeParse(base).success, true);
  assert.equal(opportunity.safeParse({ ...base, canonicalKey: '00394460000141-2026-15' }).success, false);
});

test('document: certidão exige companyId e bloco certificate', () => {
  const base = {
    id, companyId: null, opportunityId: id, kind: 'company_certificate', origin: 'upload', title: 'CND',
    sourceUrl: null, storageKey: null, mimeType: 'application/pdf', sizeBytes: 1, sha256: hash, pageCount: 1,
    textStatus: 'pending', textStorageKey: null, uploadedByUserId: id, certificate: null, fetchedAt: null,
    createdAt: now, updatedAt: now,
  };
  assert.equal(document.safeParse(base).success, false);
  assert.equal(document.safeParse({ ...base, kind: 'tender_notice' }).success, true);
});

test('humanReview: rejeição exige comentário; aprovação com mudanças exige correções', () => {
  const base = {
    id, companyId: id, subjectType: 'ai_analysis', subjectId: id, reviewerUserId: id,
    decision: 'rejected', corrections: [], comment: null, createdAt: now,
  };
  assert.equal(humanReview.safeParse(base).success, false);
  assert.equal(humanReview.safeParse({ ...base, comment: 'Prazo errado' }).success, true);
  assert.equal(humanReview.safeParse({ ...base, decision: 'approved_with_changes', comment: 'x' }).success, false);
});

test('searchProfile: minValue <= maxValue', () => {
  const base = {
    id, companyId: id, name: 'TI', includeTerms: ['notebook'], excludeTerms: [], ufs: [], modalityCodes: [],
    minValue: '10.00', maxValue: '5.00', sourceKeys: [], minScore: 50, alertChannel: 'none', ownerUserId: id,
    active: true, createdAt: now, updatedAt: now,
  };
  assert.equal(searchProfile.safeParse(base).success, false);
  assert.equal(searchProfile.safeParse({ ...base, maxValue: null }).success, true);
});

test('aiAnalysis aceita análise enfileirada sem resultado', () => {
  const r = aiAnalysis.safeParse({
    id, opportunityId: id, companyId: null, documentIds: [id], kind: 'tender_summary', status: 'queued',
    engine: null, provider: null, model: null, promptVersion: 'v1', resultSchemaVersion: 'v1', inputHash: hash,
    result: null, confidence: null, warnings: [], tokensIn: null, tokensOut: null, costUsd: null, durationMs: null,
    errorCode: null, errorMessage: null, reviewStatus: 'pending_review', requestedByUserId: id, queuedAt: now,
    startedAt: null, finishedAt: null,
  });
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
});

test('toda fila tem dono válido e payload só com campos declarados', () => {
  for (const name of Object.keys(jobs) as JobName[]) {
    assert.match(jobs[name].owner, /^0[1-4]$/);
  }
  assert.equal(jobs['analysis.run'].payload.safeParse({ analysisId: id }).success, true);
  assert.equal(jobs['analysis.run'].payload.safeParse({}).success, false);
});
