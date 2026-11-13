/** Erros de domínio da aplicação, com mensagens prontas para o usuário final. */

export type AppErrorCode =
  | 'INVALID_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'EMPTY_FILE'
  | 'INVALID_PDF'
  | 'ENCRYPTED_PDF'
  | 'TOO_MANY_PAGES'
  | 'NO_TEXT_LAYER'
  | 'AI_NOT_CONFIGURED'
  | 'AI_FAILED'
  | 'AI_INVALID_RESPONSE'
  | 'ANALYSIS_TIMEOUT'
  | 'REPORT_BROWSER_MISSING'
  | 'REPORT_FAILED'
  | 'NOT_FOUND'
  | 'PNCP_UNAVAILABLE'
  | 'PNCP_NO_PDF'
  | 'LIMITE_ATINGIDO'
  | 'BAD_REQUEST'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: string;
  /** Dica acionável mostrada na interface. */
  readonly hint?: string;

  constructor(
    code: AppErrorCode,
    message: string,
    options: { status?: number; details?: string; hint?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? 400;
    this.details = options.details;
    this.hint = options.hint;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      details: this.details,
    };
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

/**
 * Converte qualquer erro em uma resposta segura para a interface.
 *
 * Por padrão o detalhe técnico NÃO vai para o cliente: ele pode conter
 * problemas internos de schema, caminhos de arquivo do servidor ou trechos da
 * resposta do provedor de IA. O detalhe é registrado no log do servidor e
 * exposto apenas quando `EXPOSE_ERROR_DETAILS=true` (útil em desenvolvimento).
 */
export function toPublicError(error: unknown): {
  code: AppErrorCode;
  message: string;
  hint?: string;
  details?: string;
} {
  const exporDetalhes = /^(1|true|sim|yes|on)$/i.test((process.env.EXPOSE_ERROR_DETAILS ?? '').trim());

  if (isAppError(error)) {
    if (error.details) {
      console.error(
        `[editais] ${error.code}: ${error.message}${error.details ? ` — detalhe: ${error.details}` : ''}`,
      );
    }
    return {
      code: error.code,
      message: error.message,
      hint: error.hint,
      ...(exporDetalhes && error.details ? { details: error.details } : {}),
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error('[editais] erro inesperado:', error);

  return {
    code: 'INTERNAL',
    message: 'Ocorreu um erro inesperado ao processar o documento.',
    hint: 'Tente novamente. Se o erro persistir, verifique os logs do servidor.',
    ...(exporDetalhes ? { details: message } : {}),
  };
}

export const ERROR_MESSAGES: Record<AppErrorCode, string> = {
  INVALID_FILE_TYPE: 'Formato de arquivo não aceito.',
  FILE_TOO_LARGE: 'O arquivo excede o tamanho máximo permitido.',
  EMPTY_FILE: 'O arquivo enviado está vazio.',
  INVALID_PDF: 'Não foi possível ler o PDF enviado.',
  ENCRYPTED_PDF: 'O PDF está protegido por senha.',
  TOO_MANY_PAGES: 'O PDF possui mais páginas do que o limite suportado.',
  NO_TEXT_LAYER: 'O PDF não possui texto selecionável.',
  AI_NOT_CONFIGURED: 'Serviço de IA não configurado.',
  AI_FAILED: 'A análise por IA falhou.',
  AI_INVALID_RESPONSE: 'A IA retornou uma resposta fora do formato esperado.',
  ANALYSIS_TIMEOUT: 'A análise excedeu o tempo máximo.',
  REPORT_BROWSER_MISSING: 'Gerador de PDF indisponível neste ambiente.',
  REPORT_FAILED: 'Não foi possível gerar o PDF do relatório.',
  NOT_FOUND: 'Recurso não encontrado.',
  PNCP_UNAVAILABLE: 'O PNCP está indisponível no momento.',
  PNCP_NO_PDF: 'O edital não foi publicado em PDF no PNCP.',
  LIMITE_ATINGIDO: 'Limite de análises atingido.',
  BAD_REQUEST: 'Requisição inválida.',
  INTERNAL: 'Erro interno.',
};
