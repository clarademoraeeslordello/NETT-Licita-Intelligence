/**
 * Primitivas compartilhadas por todos os contratos canônicos.
 * Dono: agente 01. Alterações somente via PR aprovada (ver AGENTS.md).
 */
import { z } from 'zod';

export const CONTRACTS_VERSION = '1.0.0-draft' as const;

export const uuid = z.uuid();
export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.iso.date();

/** Valor monetário/decimal em string para evitar erro de ponto flutuante. Ex.: "12345.6789". */
export const decimal = z.string().regex(/^-?\d{1,14}(\.\d{1,4})?$/, 'decimal com até 4 casas');

export const uf = z.enum([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);
export type UF = z.infer<typeof uf>;

/** CNPJ somente dígitos (14). Validação de DV fica no módulo que recebe entrada humana. */
export const cnpj = z.string().regex(/^\d{14}$/);

export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const timestamps = {
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
};

/** Formato único de erro das rotas /api/v1. */
export const apiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;

/** Paginação por cursor usada em todas as listagens. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
