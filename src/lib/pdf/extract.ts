/**
 * Extração de texto de PDFs com preservação da paginação.
 *
 * Usa `unpdf` (build serverless do pdf.js): funciona em Node sem depender de
 * binários nativos nem de canvas.
 */
import { extractText, getDocumentProxy } from 'unpdf';
import { config } from '../config';
import { AppError } from '../errors';

export type ExtractedPage = {
  /** Número da página no PDF, começando em 1. */
  page: number;
  text: string;
  chars: number;
};

export type ExtractedDocument = {
  pages: ExtractedPage[];
  fullText: string;
  totalPages: number;
  totalChars: number;
  /** Palavras aproximadas do documento inteiro. */
  words: number;
  title?: string;
  author?: string;
};

/** Normaliza espaços mantendo quebras de linha relevantes. */
function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

const looksEncrypted = (message: string) => /password|encrypt|senha/i.test(message);

/**
 * Extrai o texto do PDF página a página.
 * @throws AppError com código específico para cada falha previsível.
 */
export async function extractDocument(buffer: Buffer): Promise<ExtractedDocument> {
  if (buffer.byteLength === 0) {
    throw new AppError('EMPTY_FILE', 'O arquivo enviado está vazio.', { status: 400 });
  }

  // Checagem barata da assinatura do arquivo antes de acionar o parser.
  const signature = buffer.subarray(0, 5).toString('latin1');
  if (!signature.startsWith('%PDF-')) {
    throw new AppError('INVALID_PDF', 'O arquivo não é um PDF válido.', {
      status: 415,
      details: 'Assinatura de arquivo ausente (%PDF-).',
      hint: 'Envie um arquivo PDF gerado por um leitor de PDF ou exportado do site do órgão.',
    });
  }

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (looksEncrypted(message)) {
      throw new AppError('ENCRYPTED_PDF', 'O PDF está protegido por senha.', {
        status: 422,
        details: message,
        hint: 'Remova a proteção do PDF e envie novamente.',
      });
    }
    throw new AppError('INVALID_PDF', 'Não foi possível ler o PDF enviado.', {
      status: 422,
      details: message,
      hint: 'O arquivo pode estar corrompido ou em um formato não suportado.',
    });
  }

  const totalPages = pdf.numPages ?? 0;
  if (totalPages === 0) {
    throw new AppError('INVALID_PDF', 'O PDF não possui páginas legíveis.', { status: 422 });
  }
  if (totalPages > config.upload.maxPages) {
    throw new AppError(
      'TOO_MANY_PAGES',
      `O PDF possui ${totalPages} páginas e o limite é ${config.upload.maxPages}.`,
      { status: 413, hint: 'Divida o documento ou aumente MAX_PDF_PAGES no .env.' },
    );
  }

  let pages: ExtractedPage[] = [];
  let metadata: Record<string, unknown> = {};
  try {
    const result = await extractText(pdf, { mergePages: false });
    const rawPages = Array.isArray(result.text) ? result.text : [String(result.text ?? '')];
    pages = rawPages.map((text, index) => {
      const clean = normalize(String(text ?? ''));
      return { page: index + 1, text: clean, chars: clean.length };
    });
    metadata = (result as { info?: Record<string, unknown> }).info ?? {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError('INVALID_PDF', 'Falha ao extrair o texto do PDF.', {
      status: 422,
      details: message,
    });
  }

  const fullText = pages
    .map((page) => `\n\n===== [PÁGINA ${page.page}] =====\n${page.text}`)
    .join('')
    .trim();

  const totalChars = pages.reduce((acc, page) => acc + page.chars, 0);
  const words = fullText.split(/\s+/).filter(Boolean).length;

  return {
    pages,
    fullText,
    totalPages,
    totalChars,
    words,
    title: typeof metadata.Title === 'string' ? metadata.Title : undefined,
    author: typeof metadata.Author === 'string' ? metadata.Author : undefined,
  };
}

/**
 * PDFs escaneados (imagem) não têm camada de texto. Detectamos isso para
 * devolver uma mensagem útil em vez de uma análise vazia.
 */
export function assertHasTextLayer(document: ExtractedDocument): void {
  if (document.totalChars < config.upload.minCharsForAnalysis) {
    throw new AppError(
      'NO_TEXT_LAYER',
      'O PDF não possui texto selecionável suficiente para análise.',
      {
        status: 422,
        details: `Apenas ${document.totalChars} caracteres extraídos em ${document.totalPages} página(s).`,
        hint: 'O documento parece ser digitalizado (imagem). Aplique OCR antes de enviar ou envie o PDF original publicado pelo órgão.',
      },
    );
  }
}
