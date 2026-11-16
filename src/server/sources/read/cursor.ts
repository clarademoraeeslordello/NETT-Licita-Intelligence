/**
 * Cursor opaco de paginação por chave (keyset). Base64url de JSON versionado, validado com Zod.
 * Cursor inválido ou de outra ordenação → `InvalidCursor` (a rota responde 400).
 */
import { z } from 'zod';
import { HttpError } from '../../http/errors';

/** Cursor inválido = 400 (ADR-022): `withApi` converte em `apiError`. */
export class InvalidCursor extends HttpError {
  constructor() {
    super('BAD_REQUEST', 400, 'Cursor inválido.');
    this.name = 'InvalidCursor';
  }
}

const keyset = z.object({ v: z.literal(1), s: z.string().max(40), k: z.string().max(60).nullable(), id: z.string().max(60) });
export type Keyset = z.infer<typeof keyset>;

export const encodeCursor = (c: Omit<Keyset, 'v'>): string => Buffer.from(JSON.stringify({ v: 1, ...c })).toString('base64url');

export function decodeCursor(raw: string, sort: string): Keyset {
  try {
    const parsed = keyset.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    if (parsed.s !== sort) throw new InvalidCursor();
    return parsed;
  } catch {
    throw new InvalidCursor();
  }
}
