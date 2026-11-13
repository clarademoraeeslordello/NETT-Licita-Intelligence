/**
 * Gerador de PDF mínimo, sem dependências externas.
 *
 * Existe por dois motivos:
 *  1. cria o edital de demonstração versionado no repositório (texto de verdade,
 *     com camada de texto selecionável, para o pipeline ser exercitado de fato);
 *  2. permite gerar PDFs de teste em ambientes sem navegador headless.
 *
 * Escreve PDF 1.4 com fontes base (Helvetica/Helvetica-Bold/Times) e
 * WinAnsiEncoding, o que cobre acentuação do português.
 */

const A4 = { width: 595.28, height: 841.89 };

const WIN_ANSI_EXTRA: Record<string, number> = {
  '\u20AC': 0x80,
  '\u201A': 0x82,
  '\u0192': 0x83,
  '\u201E': 0x84,
  '\u2026': 0x85,
  '\u2020': 0x86,
  '\u2021': 0x87,
  '\u02C6': 0x88,
  '\u2030': 0x89,
  '\u0160': 0x8a,
  '\u2039': 0x8b,
  '\u0152': 0x8c,
  '\u017D': 0x8e,
  '\u2018': 0x91,
  '\u2019': 0x92,
  '\u201C': 0x93,
  '\u201D': 0x94,
  '\u2022': 0x95,
  '\u2013': 0x96,
  '\u2014': 0x97,
  '\u02DC': 0x98,
  '\u2122': 0x99,
  '\u0161': 0x9a,
  '\u203A': 0x9b,
  '\u0153': 0x9c,
  '\u017E': 0x9e,
  '\u0178': 0x9f,
};

function toWinAnsi(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (WIN_ANSI_EXTRA[char] !== undefined) {
      out += String.fromCharCode(WIN_ANSI_EXTRA[char]);
    } else if (code <= 0xff) {
      out += char;
    } else {
      out += '?';
    }
  }
  return out;
}

const escapeString = (text: string): string =>
  toWinAnsi(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ');

/** Métricas aproximadas de Helvetica (suficientes para quebra de linha). */
function textWidth(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 32;
    if (char === ' ') units += 278;
    else if (/[iljtfIr.,:;'|!\[\]()]/.test(char)) units += 260;
    else if (/[A-ZÀ-Þ0-9]/.test(char)) units += bold ? 640 : 620;
    else if (/[mwMW]/.test(char)) units += bold ? 900 : 860;
    else units += bold ? 570 : 550;
    if (code > 0xff) units += 0;
  }
  return (units / 1000) * size;
}

export type Margin = { top: number; right: number; bottom: number; left: number };

export type TextOptions = {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: [number, number, number];
  lineHeight?: number;
  align?: 'left' | 'right' | 'center';
  spaceAfter?: number;
  indent?: number;
};

export type TableColumn = { header: string; width: number; align?: 'left' | 'right' | 'center' };

export type TableOptions = {
  columns: TableColumn[];
  rows: string[][];
  size?: number;
  headerBackground?: [number, number, number];
  zebra?: boolean;
  spaceAfter?: number;
};

/** Construtor de PDF com paginação automática e numeração de rodapé. */
export class PdfBuilder {
  private pages: string[] = [];
  private current: string[] = [];
  private y = 0;
  private readonly margin: Margin;
  private readonly footer: string;
  private readonly fonts: { regular: string; bold: string; italic: string };
  private built = false;

  constructor(options: { margin?: Partial<Margin>; footer?: string } = {}) {
    this.margin = { top: 64, right: 56, bottom: 64, left: 56, ...options.margin };
    this.footer = options.footer ?? '';
    this.fonts = { regular: 'F1', bold: 'F2', italic: 'F3' };
    this.y = A4.height - this.margin.top;
  }

  get contentWidth(): number {
    return A4.width - this.margin.left - this.margin.right;
  }

  get pageCount(): number {
    return this.pages.length + (this.current.length || this.y < A4.height - this.margin.top ? 1 : 0);
  }

  private font(options: TextOptions): string {
    if (options.bold) return this.fonts.bold;
    if (options.italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  private ensure(space: number): void {
    if (this.y - space < this.margin.bottom) this.newPage();
  }

  newPage(): void {
    if (this.current.length) this.pages.push(this.current.join('\n'));
    this.current = [];
    this.y = A4.height - this.margin.top;
  }

  /** Quebra o texto respeitando a largura disponível. */
  private wrap(text: string, size: number, bold: boolean, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (textWidth(candidate, size, bold) > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  text(content: string, options: TextOptions = {}): void {
    const size = options.size ?? 10.5;
    const lineHeight = (options.lineHeight ?? 1.4) * size;
    const indent = options.indent ?? 0;
    const maxWidth = this.contentWidth - indent;
    const lines = this.wrap(content, size, Boolean(options.bold), maxWidth);
    const color = options.color ?? [0.06, 0.09, 0.16];

    for (const line of lines) {
      this.ensure(lineHeight);
      const width = textWidth(line, size, Boolean(options.bold));
      let x = this.margin.left + indent;
      if (options.align === 'right') x = A4.width - this.margin.right - width;
      if (options.align === 'center') x = (A4.width - width) / 2;
      this.current.push(
        `BT /${this.font(options)} ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ${x.toFixed(2)} ${(this.y - size).toFixed(2)} Td (${escapeString(line)}) Tj ET`,
      );
      this.y -= lineHeight;
    }
    this.y -= options.spaceAfter ?? 0;
  }

  /** Título de seção com linha divisória. */
  heading(content: string, options: { size?: number; spaceBefore?: number } = {}): void {
    this.y -= options.spaceBefore ?? 14;
    const size = options.size ?? 13;
    this.ensure(size * 2.4);
    this.text(content.toUpperCase(), { size, bold: true, spaceAfter: 2, color: [0.11, 0.16, 0.28] });
    this.line();
    this.y -= 6;
  }

  line(color: [number, number, number] = [0.78, 0.82, 0.88], width = 0.8): void {
    this.ensure(6);
    this.current.push(
      `${color[0]} ${color[1]} ${color[2]} RG ${width} w ${this.margin.left} ${this.y.toFixed(2)} m ${(A4.width - this.margin.right).toFixed(2)} ${this.y.toFixed(2)} l S`,
    );
    this.y -= 6;
  }

  bullet(content: string, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const lineHeight = (options.lineHeight ?? 1.38) * size;
    const lines = this.wrap(content, size, Boolean(options.bold), this.contentWidth - 16);
    lines.forEach((line, index) => {
      this.ensure(lineHeight);
      if (index === 0) {
        this.current.push(
          `BT /${this.fonts.bold} ${size} Tf 0.35 0.42 0.55 rg ${this.margin.left.toFixed(2)} ${(this.y - size).toFixed(2)} Td (\\267) Tj ET`,
        );
      }
      this.current.push(
        `BT /${this.font({ ...options, bold: options.bold })} ${size} Tf 0.06 0.09 0.16 rg ${(this.margin.left + 16).toFixed(2)} ${(this.y - size).toFixed(2)} Td (${escapeString(line)}) Tj ET`,
      );
      this.y -= lineHeight;
    });
    this.y -= options.spaceAfter ?? 1;
  }

  table(options: TableOptions): void {
    const size = options.size ?? 9;
    const padding = 5;
    const rowHeight = size * 1.55 + padding;
    const headerBackground = options.headerBackground ?? [0.94, 0.96, 0.99];

    this.ensure(rowHeight * 2);

    // Cabeçalho
    let x = this.margin.left;
    this.current.push(
      `${headerBackground[0]} ${headerBackground[1]} ${headerBackground[2]} rg ${this.margin.left.toFixed(2)} ${(this.y - rowHeight).toFixed(2)} ${this.contentWidth.toFixed(2)} ${rowHeight.toFixed(2)} re f`,
    );
    for (const column of options.columns) {
      const label = column.header;
      const cx =
        column.align === 'right'
          ? x + column.width - padding - textWidth(label, size, true)
          : x + padding;
      this.current.push(
        `BT /${this.fonts.bold} ${size} Tf 0.28 0.35 0.48 rg ${cx.toFixed(2)} ${(this.y - size - padding / 2).toFixed(2)} Td (${escapeString(label)}) Tj ET`,
      );
      x += column.width;
    }
    this.y -= rowHeight;

    options.rows.forEach((row, rowIndex) => {
      this.ensure(rowHeight);
      if (options.zebra !== false && rowIndex % 2 === 1) {
        this.current.push(
          `0.98 0.99 1 rg ${this.margin.left.toFixed(2)} ${(this.y - rowHeight).toFixed(2)} ${this.contentWidth.toFixed(2)} ${rowHeight.toFixed(2)} re f`,
        );
      }
      let cx = this.margin.left;
      options.columns.forEach((column, columnIndex) => {
        const value = row[columnIndex] ?? '';
        const maxWidth = column.width - padding * 2;
        let display = value;
        while (textWidth(display, size, false) > maxWidth && display.length > 4) {
          display = `${display.slice(0, -2)}`;
        }
        if (display !== value) display = `${display.slice(0, -1)}\u2026`;
        const tx =
          column.align === 'right'
            ? cx + column.width - padding - textWidth(display, size, false)
            : cx + padding;
        this.current.push(
          `BT /${this.fonts.regular} ${size} Tf 0.11 0.15 0.24 rg ${tx.toFixed(2)} ${(this.y - size - padding / 2).toFixed(2)} Td (${escapeString(display)}) Tj ET`,
        );
        cx += column.width;
      });
      this.current.push(
        `0.88 0.9 0.94 RG 0.5 w ${this.margin.left.toFixed(2)} ${(this.y - rowHeight).toFixed(2)} m ${(A4.width - this.margin.right).toFixed(2)} ${(this.y - rowHeight).toFixed(2)} l S`,
      );
      this.y -= rowHeight;
    });

    this.y -= options.spaceAfter ?? 8;
  }

  spacer(height: number): void {
    this.y -= height;
  }

  /** Finaliza o PDF, aplicando rodapé com numeração em todas as páginas. */
  build(metadata: { title?: string; author?: string; subject?: string } = {}): Buffer {
    if (this.built) throw new Error('PdfBuilder.build() já foi chamado para esta instância.');
    this.built = true;

    if (this.current.length) this.pages.push(this.current.join('\n'));
    // Um PDF sem páginas é inválido para a maioria dos leitores: emitimos uma
    // página em branco em vez de um documento quebrado.
    if (this.pages.length === 0) this.pages.push('');

    const withFooters = this.pages.map((content, index) => {
      const label = `${this.footer ? `${this.footer}  ·  ` : ''}Página ${index + 1} de ${this.pages.length}`;
      const width = textWidth(label, 8, false);
      const footer = `BT /F1 8 Tf 0.45 0.5 0.6 rg ${(A4.width - this.margin.right - width).toFixed(2)} ${(this.margin.bottom - 26).toFixed(2)} Td (${escapeString(label)}) Tj ET`;
      return `${content}\n${footer}`;
    });

    const objects: string[] = [];
    const pageObjectIds: number[] = [];
    // 1: catalog, 2: pages, 3..5: fontes, 6: info, depois páginas e conteúdos.
    const firstPageObject = 7;

    withFooters.forEach((_, index) => pageObjectIds.push(firstPageObject + index * 2));

    objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objects[2] = `<< /Type /Pages /Count ${withFooters.length} /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] >>`;
    objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
    objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
    objects[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>`;

    const info: string[] = [];
    if (metadata.title) info.push(`/Title (${escapeString(metadata.title)})`);
    if (metadata.author) info.push(`/Author (${escapeString(metadata.author)})`);
    if (metadata.subject) info.push(`/Subject (${escapeString(metadata.subject)})`);
    info.push(`/Producer (PdfBuilder)`);
    objects[6] = `<< ${info.join(' ')} >>`;

    withFooters.forEach((content, index) => {
      const pageId = firstPageObject + index * 2;
      const contentId = pageId + 1;
      objects[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width.toFixed(2)} ${A4.height.toFixed(2)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
    });

    let pdf = `%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n`;
    const offsets: number[] = [];
    for (let id = 1; id < objects.length; id += 1) {
      const body = objects[id];
      if (body === undefined) continue;
      offsets[id] = Buffer.byteLength(pdf, 'latin1');
      pdf += `${id} 0 obj\n${body}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, 'latin1');
    const maxId = objects.length;
    pdf += `xref\n0 ${maxId}\n0000000000 65535 f \n`;
    for (let id = 1; id < maxId; id += 1) {
      const offset = offsets[id] ?? 0;
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${maxId} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, 'latin1');
  }
}

export const A4_SIZE = A4;
