/**
 * DTOs of /api/v1/companies/{cid}/reviews (T-304), CONTRACTS §4. Import from '@/contracts/api/reviews'.
 * The reviewer is ALWAYS the session user and the company comes from the path: neither is accepted in the body.
 */
import { z } from 'zod';
import { reviewDecision, reviewSubject } from '../analysis';
import { uuid } from '../common';

const MAX_VALUE_JSON = 10_000;
const boundedJson = (label: string) =>
  z.unknown().refine((v) => v === undefined || JSON.stringify(v ?? null).length <= MAX_VALUE_JSON, { message: `${label} excede ${MAX_VALUE_JSON} caracteres` });

/** `datas.encerramentoPropostas`, `participacao.documentos[2].text` … */
export const CORRECTION_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+|\[\d+\])*$/;

export const correctionInput = z
  .object({
    path: z.string().max(200).regex(CORRECTION_PATH, 'caminho inválido'),
    previous: boundedJson('previous'),
    corrected: boundedJson('corrected'),
    note: z.string().trim().max(1_000).nullish().transform((v) => v || null),
  })
  .strict()
  .transform((c) => ({ ...c, previous: c.previous ?? null, corrected: c.corrected ?? null }));

export const reviewInput = z
  .object({
    subjectType: reviewSubject,
    subjectId: uuid,
    decision: reviewDecision,
    corrections: z.array(correctionInput).max(50).default([]),
    comment: z.string().trim().max(5_000).nullish().transform((v) => v || null),
  })
  .strict()
  .refine((r) => r.decision !== 'approved_with_changes' || r.corrections.length > 0, { message: 'approved_with_changes exige corrections', path: ['corrections'] })
  .refine((r) => r.decision !== 'rejected' || r.comment !== null, { message: 'rejected exige comment', path: ['comment'] });

export type ReviewInput = z.output<typeof reviewInput>;

/** GET /api/v1/companies/{cid}/reviews?subjectType=&subjectId=&limit=&cursor= (newest first, cursor pagination). */
export const reviewListQuery = z
  .object({
    subjectType: reviewSubject,
    subjectId: uuid,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type ReviewListQuery = z.output<typeof reviewListQuery>;
