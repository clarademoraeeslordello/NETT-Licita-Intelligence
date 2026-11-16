/** Utilidades das rotas de leitura: validação de parâmetros e respostas de erro no formato `apiError`. */
import { NextResponse } from 'next/server';
import type { z } from 'zod';

export const apiError = (status: number, code: string, message: string, details?: unknown) =>
  NextResponse.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Valida `URLSearchParams` com o schema; chaves repetidas usam o último valor. */
export function parseQuery<S extends z.ZodType>(schema: S, params: URLSearchParams): Parsed<z.infer<S>> {
  const raw: Record<string, string> = {};
  for (const [k, v] of params) raw[k] = v;
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    response: apiError(400, 'BAD_REQUEST', 'Parâmetros inválidos.', r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message }))),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);
