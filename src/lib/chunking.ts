/**
 * Estratégia de divisão de editais longos.
 *
 * Regras:
 *  - Nunca cortamos o documento em um ponto arbitrário: respeitamos fronteiras
 *    de página e, quando uma única página é maior que o bloco, quebramos em
 *    linhas completas.
 *  - Cada bloco sabe de quais páginas veio — é isso que permite rastrear
 *    "Página 12" no relatório final.
 *  - Blocos vizinhos compartilham uma pequena sobreposição para não perder
 *    contexto em cláusulas que atravessam páginas.
 */
import { config } from './config';
import type { ExtractedDocument, ExtractedPage } from './pdf/extract';

export type DocumentChunk = {
  index: number;
  label: string;
  text: string;
  pages: number[];
  chars: number;
  /**
   * Presente apenas quando o documento excedeu MAX_CHUNKS e o excedente foi
   * descartado. Serve para que a análise avise explicitamente que o documento
   * não foi lido por inteiro.
   */
  truncated?: {
    blocosDescartados: number;
    paginasDescartadas: number[];
    charsDescartados: number;
  };
};

export type PageIndexEntry = {
  page: number;
  chars: number;
  preview: string;
};

/** Quebra uma página muito grande em partes, sempre em fim de linha. */
function splitOversizedPage(page: ExtractedPage, maxChars: number): ExtractedPage[] {
  if (page.chars <= maxChars) return [page];
  const lines = page.text.split('\n');
  const parts: ExtractedPage[] = [];
  let buffer: string[] = [];
  let size = 0;

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join('\n').trim();
    parts.push({ page: page.page, text, chars: text.length });
    buffer = [];
    size = 0;
  };

  for (const line of lines) {
    if (size + line.length + 1 > maxChars && buffer.length) flush();
    buffer.push(line);
    size += line.length + 1;
  }
  flush();

  // O tamanho é recalculado DEPOIS do prefixo de continuação, para que o
  // orçamento de caracteres por bloco continue fiel ao texto que será enviado.
  return parts.map((part, position) => {
    const text =
      parts.length > 1
        ? `[continuação da página ${page.page} — parte ${position + 1} de ${parts.length}]\n${part.text}`
        : part.text;
    return { page: page.page, text, chars: text.length };
  });
}

export function isDocumentLong(document: ExtractedDocument): boolean {
  return document.totalChars > config.chunking.singleCallMaxChars;
}

/**
 * Monta os blocos do documento.
 * Para documentos curtos resulta em um único bloco com o texto integral.
 */
export function buildChunks(document: ExtractedDocument): DocumentChunk[] {
  const { chunkChars, overlapChars, maxChunks } = config.chunking;

  const expanded = document.pages.flatMap((page) => splitOversizedPage(page, chunkChars));

  // Documento curto: uma única chamada, sem divisão nem perda de contexto.
  if (!isDocumentLong(document)) {
    return [
      {
        index: 0,
        label: 'Documento completo',
        text: document.fullText,
        pages: document.pages.map((page) => page.page),
        chars: document.fullText.length,
      },
    ];
  }

  const chunks: DocumentChunk[] = [];
  let current: { text: string[]; pages: number[]; size: number } = { text: [], pages: [], size: 0 };

  const flush = () => {
    if (!current.text.length) return;
    const firstPage = current.pages[0];
    const lastPage = current.pages[current.pages.length - 1];
    chunks.push({
      index: chunks.length,
      label:
        firstPage === lastPage ? `Página ${firstPage}` : `Páginas ${firstPage}–${lastPage}`,
      text: current.text.join('\n').trim(),
      pages: [...new Set(current.pages)],
      chars: current.size,
    });
    current = { text: [], pages: [], size: 0 };
  };

  for (const page of expanded) {
    // Página isolada já é maior que o bloco: vira seu próprio bloco.
    if (page.chars >= chunkChars) {
      flush();
      chunks.push({
        index: chunks.length,
        label: `Página ${page.page}`,
        text: page.text,
        pages: [page.page],
        chars: page.chars,
      });
      continue;
    }

    if (current.size + page.chars > chunkChars && current.text.length) {
      const previousPages = current.pages;
      flush();
      // Sobreposição: reinsere o final do bloco anterior como contexto.
      const previousText = chunks[chunks.length - 1].text.slice(-overlapChars).trim();
      if (previousText) {
        current.text.push(
          `[contexto do trecho anterior — páginas ${previousPages.join(', ')}]\n${previousText}`,
        );
        current.size += previousText.length;
      }
    }

    current.text.push(`\n===== [PÁGINA ${page.page}] =====\n${page.text}`);
    current.pages.push(page.page);
    current.size += page.chars + 32;
  }
  flush();

  if (chunks.length > maxChunks) {
    // Rede de segurança: em vez de fundir blocos (o que exigiria cortar texto —
    // inaceitável, porque o relatório se apresentaria como leitura completa),
    // removemos os blocos excedentes. Quem decide o limite é MAX_CHUNKS:
    // documentos maiores exigem aumentar o limite (custo maior de tokens).
    const mantidos = chunks.slice(0, maxChunks);
    const descartados = chunks.slice(maxChunks);
    const perda = {
      blocosDescartados: descartados.length,
      paginasDescartadas: [...new Set(descartados.flatMap((chunk) => chunk.pages))],
      charsDescartados: descartados.reduce((acc, chunk) => acc + chunk.chars, 0),
    };

    const resultado = mantidos.map((chunk, index) => ({ ...chunk, index }));
    // A informação da perda é anexada ao último bloco mantido para que o
    // orquestrador possa avisar explicitamente no relatório.
    resultado[resultado.length - 1] = {
      ...resultado[resultado.length - 1],
      truncated: perda,
    } as DocumentChunk & { truncated: typeof perda };
    return resultado;
  }

  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

/** Índice de páginas enviado na etapa de síntese (mapa do documento). */
export function buildPageIndex(document: ExtractedDocument): PageIndexEntry[] {
  const { indexPreviewChars } = config.chunking;
  return document.pages.map((page) => ({
    page: page.page,
    chars: page.chars,
    preview: page.text.replace(/\s+/g, ' ').slice(0, indexPreviewChars),
  }));
}

/** Estimativa simples de tokens (≈3,6 caracteres por token em português). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}
