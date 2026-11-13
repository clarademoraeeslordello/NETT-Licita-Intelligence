export type AuthErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'USER_INACTIVE' | 'LOGIN_FAILED' | 'BAD_ORIGIN';

/** Erro de autenticação/autorização. `status` vira o HTTP status em `withApi`. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly status: 400 | 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const unauthenticated = () => new AuthError('UNAUTHENTICATED', 401, 'Sessão ausente ou expirada.');
export const forbidden = (msg = 'Acesso negado.') => new AuthError('FORBIDDEN', 403, msg);
