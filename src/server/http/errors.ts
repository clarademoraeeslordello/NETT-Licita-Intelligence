/**
 * Erro HTTP comum das rotas /api/v1 (ADR-022). `withApi` converte qualquer HttpError em `apiError`
 * (CONTRACTS §4) com o status indicado. Use os atalhos abaixo; `details` só com dado seguro para
 * o cliente (nunca stack, SQL, segredo nem dado de outra empresa).
 */
export type HttpStatus = 400 | 401 | 403 | 404 | 405 | 409 | 410 | 413 | 415 | 422 | 429;

export class HttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: HttpStatus,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message = 'Requisição inválida.', details?: unknown) => new HttpError('BAD_REQUEST', 400, message, details);
/** 404 também para "existe, mas é de outra empresa": não revela a existência. */
export const notFound = (message = 'Não encontrado.') => new HttpError('NOT_FOUND', 404, message);
export const conflict = (message = 'Conflito com o estado atual.', details?: unknown) => new HttpError('CONFLICT', 409, message, details);
export const unprocessable = (message = 'Dados inválidos.', details?: unknown) => new HttpError('UNPROCESSABLE', 422, message, details);
