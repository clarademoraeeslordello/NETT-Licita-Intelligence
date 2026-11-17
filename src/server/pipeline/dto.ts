/**
 * DTOs de /api/v1/companies/{cid}/pipeline e /certificates (T-406, agente 04).
 * Ficam aqui porque o agente 04 não escreve em `src/contracts/api`; proposta ao 01: mover para
 * `src/contracts/api/pipeline.ts` (CONTRACTS §4 pede DTOs lá). Entidades canônicas vêm de `@/contracts`.
 * Empresa vem do caminho; usuário, da sessão: nenhum dos dois é aceito no corpo.
 */
import { z } from 'zod';
import { certificateCategory, decimal, isoDate, pipelineStage, uuid } from '@/contracts';

const notes = z.string().trim().max(5_000);

/** POST …/pipeline — adiciona a oportunidade à triagem da empresa. */
export const trackingCreateInput = z.object({ opportunityId: uuid, notes: notes.optional() }).strict();
export type TrackingCreateInput = z.output<typeof trackingCreateInput>;

export const trackingOutcome = z.enum(['won', 'lost', 'withdrawn']);

/** PATCH …/pipeline/{id}. `discarded: true` descarta; `false` reabre. */
export const trackingUpdateInput = z
  .object({
    stage: pipelineStage.optional(),
    assignedConsultantId: uuid.nullable().optional(),
    proposalValue: decimal.nullable().optional(),
    outcome: trackingOutcome.nullable().optional(),
    bidDecisionReviewId: uuid.nullable().optional(),
    notes: notes.optional(),
    discarded: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'informe ao menos um campo' });
export type TrackingUpdateInput = z.output<typeof trackingUpdateInput>;

/** Etapas que exigem parecer de decisão aprovado (CONTRACTS §2, invariante 3). */
export const STAGES_NEED_DECISION: ReadonlySet<string> = new Set(['proposal', 'dispute', 'result']);

export const trackingListQuery = z
  .object({
    includeDiscarded: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

const text = (max: number) => z.string().trim().min(1).max(max);
const certificateFields = {
  category: certificateCategory,
  issuer: text(200),
  issuedAt: isoDate.nullable().default(null),
  validUntil: isoDate.nullable().default(null),
  defaultValidityDays: z.number().int().positive().max(3_650).nullable().default(null),
  issueUrl: z.url({ protocol: /^https$/ }).max(2_000).nullable().default(null),
};

const datesOrdered = (v: { issuedAt?: string | null; validUntil?: string | null }) => !v.issuedAt || !v.validUntil || v.issuedAt <= v.validUntil;
const datesMessage = { message: 'validUntil não pode ser anterior a issuedAt', path: ['validUntil'] };

/** POST …/certificates — só metadados. O arquivo entra por T-212 (agente 02). */
export const certificateCreateInput = z.object({ title: text(200), ...certificateFields }).strict().refine(datesOrdered, datesMessage);
export type CertificateCreateInput = z.output<typeof certificateCreateInput>;

/** PATCH …/certificates/{id} — qualquer subconjunto; renovar = novas datas. */
export const certificateUpdateInput = z
  .object({
    title: text(200),
    category: certificateCategory,
    issuer: text(200),
    issuedAt: isoDate.nullable(),
    validUntil: isoDate.nullable(),
    defaultValidityDays: z.number().int().positive().max(3_650).nullable(),
    issueUrl: z.url({ protocol: /^https$/ }).max(2_000).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'informe ao menos um campo' })
  .refine(datesOrdered, datesMessage);
export type CertificateUpdateInput = z.output<typeof certificateUpdateInput>;
