import { HttpError } from '../http/errors';

export type AuthErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'USER_INACTIVE' | 'LOGIN_FAILED' | 'BAD_ORIGIN';

/** Erro de autenticação/autorização. É um HttpError: `withApi` o converte no status indicado. */
export class AuthError extends HttpError {
  declare readonly code: AuthErrorCode;
  declare readonly status: 400 | 401 | 403;
  constructor(code: AuthErrorCode, status: 400 | 401 | 403, message: string) {
    super(code, status, message);
    this.name = 'AuthError';
  }
}

export const unauthenticated = () => new AuthError('UNAUTHENTICATED', 401, 'Sessão ausente ou expirada.');
export const forbidden = (msg = 'Acesso negado.') => new AuthError('FORBIDDEN', 403, msg);
