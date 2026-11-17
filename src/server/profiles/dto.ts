/**
 * DTOs de /api/v1/companies/{cid}/search-profiles e /capabilities (T-216), CONTRACTS §4.
 *
 * Ficam em `src/server/profiles` (área do agente 03) porque o agente 03 não escreve em `src/contracts`.
 * O agente 01 pode movê-los para `src/contracts/api/` sem mudar o comportamento (handoff T-216).
 * A empresa vem SEMPRE do caminho e o dono do perfil é SEMPRE o usuário da sessão: nenhum dos dois é aceito no corpo.
 */
import { z } from 'zod';
import { capabilityKind, capabilitySubject, decimal, financialIndicators, isoDate, uf, uuid } from '../../contracts';

/** Igual ao `alertChannel` de `searchProfile` (contrato); o enum não é exportado separado. */
const alertChannel = z.enum(['none', 'in_app', 'email']);

export const MAX_BODY = 100_000;

const term = z.string().trim().min(1).max(80);
/** Remove repetições (sem diferenciar maiúsculas) mantendo a primeira grafia e a ordem. */
const dedupe = (list: string[]) => {
  const seen = new Set<string>();
  return list.filter((t) => {
    const k = t.toLocaleLowerCase('pt-BR');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const terms = (max: number) => z.array(term).max(max).transform(dedupe);
const unique = <T extends string | number>(list: T[]) => [...new Set(list)];
const sourceKey = z.string().regex(/^[a-z0-9_]{2,40}$/, 'chave de fonte inválida');
const modalityCode = z.number().int().min(1).max(99);
const score = z.number().int().min(0).max(100);
const name = z.string().trim().min(1).max(120);

/* ------------------------------ SearchProfile ----------------------------- */

const profileFields = {
  name,
  includeTerms: terms(50).refine((t) => t.length >= 1, { message: 'informe ao menos um termo de inclusão' }),
  excludeTerms: terms(50),
  ufs: z.array(uf).max(27).transform(unique),
  modalityCodes: z.array(modalityCode).max(20).transform(unique),
  minValue: decimal.nullable(),
  maxValue: decimal.nullable(),
  sourceKeys: z.array(sourceKey).max(20).transform(unique),
  minScore: score,
  alertChannel,
  active: z.boolean(),
};

/** minValue <= maxValue. Reaplicada depois do merge no PATCH (um só campo pode quebrar a faixa gravada). */
export const valueRangeOk = (p: { minValue: string | null; maxValue: string | null }) => p.minValue === null || p.maxValue === null || Number(p.minValue) <= Number(p.maxValue);
const RANGE_MESSAGE = { message: 'minValue deve ser <= maxValue', path: ['minValue'] };

export const searchProfileCreate = z
  .object({
    name: profileFields.name,
    includeTerms: profileFields.includeTerms,
    excludeTerms: profileFields.excludeTerms.default([]),
    ufs: profileFields.ufs.default([]),
    modalityCodes: profileFields.modalityCodes.default([]),
    minValue: profileFields.minValue.default(null),
    maxValue: profileFields.maxValue.default(null),
    sourceKeys: profileFields.sourceKeys.default([]),
    minScore: profileFields.minScore.default(50),
    alertChannel: profileFields.alertChannel.default('none'),
    active: profileFields.active.default(true),
  })
  .strict()
  .refine(valueRangeOk, RANGE_MESSAGE);
export type SearchProfileCreate = z.output<typeof searchProfileCreate>;

export const searchProfilePatch = z
  .object({
    name: profileFields.name.optional(),
    includeTerms: profileFields.includeTerms.optional(),
    excludeTerms: profileFields.excludeTerms.optional(),
    ufs: profileFields.ufs.optional(),
    modalityCodes: profileFields.modalityCodes.optional(),
    minValue: profileFields.minValue.optional(),
    maxValue: profileFields.maxValue.optional(),
    sourceKeys: profileFields.sourceKeys.optional(),
    minScore: profileFields.minScore.optional(),
    alertChannel: profileFields.alertChannel.optional(),
    active: profileFields.active.optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'informe ao menos um campo para alterar' });
export type SearchProfilePatch = z.output<typeof searchProfilePatch>;

/** Campos que mudam QUEM casa ou a nota. `name`, `minScore` e `alertChannel` não entram no cálculo do `match.score`. */
export const MATCH_FIELDS = ['includeTerms', 'excludeTerms', 'ufs', 'modalityCodes', 'minValue', 'maxValue', 'sourceKeys'] as const;

/* ---------------------------- CompanyCapability --------------------------- */

const capabilityFields = {
  kind: capabilityKind,
  subject: capabilitySubject,
  name,
  description: z.string().trim().max(2_000),
  keywords: terms(50),
  catalogCodes: z.array(z.string().trim().min(1).max(40)).max(100).transform(unique),
  ufs: profileFields.ufs,
  maxContractValue: decimal.nullable(),
  evidenceDocumentId: uuid.nullable(),
  validUntil: isoDate.nullable(),
  active: z.boolean(),
  financialIndicators: financialIndicators.nullable(),
};

type CapabilityShape = { kind: string; subject: string; financialIndicators: unknown };
/** Mesmas regras do `companyCapability` (contrato), reaplicadas no create e depois do merge do PATCH. */
export const capabilityRules = (c: CapabilityShape): string | null => {
  if (c.financialIndicators !== null && c.kind !== 'financial_capacity') return 'financialIndicators só vale para kind = financial_capacity';
  if (c.subject !== 'company' && c.kind !== 'certification' && c.kind !== 'technical_attestation') return "subject 'professional' só vale para certification ou technical_attestation";
  return null;
};
const rulesRefine = (c: CapabilityShape, ctx: z.RefinementCtx) => {
  const msg = capabilityRules(c);
  if (msg) ctx.addIssue({ code: 'custom', message: msg });
};

export const capabilityCreate = z
  .object({
    kind: capabilityFields.kind,
    subject: capabilityFields.subject.default('company'),
    name: capabilityFields.name,
    description: capabilityFields.description.default(''),
    keywords: capabilityFields.keywords.default([]),
    catalogCodes: capabilityFields.catalogCodes.default([]),
    ufs: capabilityFields.ufs.default([]),
    maxContractValue: capabilityFields.maxContractValue.default(null),
    evidenceDocumentId: capabilityFields.evidenceDocumentId.default(null),
    validUntil: capabilityFields.validUntil.default(null),
    active: capabilityFields.active.default(true),
    financialIndicators: capabilityFields.financialIndicators.default(null),
  })
  .strict()
  .superRefine(rulesRefine);
export type CapabilityCreate = z.output<typeof capabilityCreate>;

export const capabilityPatch = z
  .object({
    kind: capabilityFields.kind.optional(),
    subject: capabilityFields.subject.optional(),
    name: capabilityFields.name.optional(),
    description: capabilityFields.description.optional(),
    keywords: capabilityFields.keywords.optional(),
    catalogCodes: capabilityFields.catalogCodes.optional(),
    ufs: capabilityFields.ufs.optional(),
    maxContractValue: capabilityFields.maxContractValue.optional(),
    evidenceDocumentId: capabilityFields.evidenceDocumentId.optional(),
    validUntil: capabilityFields.validUntil.optional(),
    active: capabilityFields.active.optional(),
    financialIndicators: capabilityFields.financialIndicators.optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'informe ao menos um campo para alterar' });
export type CapabilityPatch = z.output<typeof capabilityPatch>;

/* --------------------------------- listas --------------------------------- */

export const listQuery = z
  .object({
    /** Ausente = todos. */
    active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(300).optional(),
  })
  .strict();
export type ListQuery = z.output<typeof listQuery>;

export const idParam = uuid;
