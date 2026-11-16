/** Utilidades das rotas de leitura: validação de parâmetros e identificadores (erros via HttpError, ADR-022). */
import type { z } from 'zod';
import { badRequest } from '../../http/errors';

/** Valida `URLSearchParams` com o schema; chaves repetidas usam o último valor. Lança 400 com os campos inválidos. */
export function parseQuery<S extends z.ZodType>(schema: S, params: URLSearchParams): z.infer<S> {
  const raw: Record<string, string> = {};
  for (const [k, v] of params) raw[k] = v;
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  throw badRequest('Parâmetros inválidos.', r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Identificador de rota: devolve o próprio valor ou lança 400. */
export function uuidParam(v: string): string {
  if (!UUID.test(v)) throw badRequest('Identificador inválido.');
  return v;
}
