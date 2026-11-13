/**
 * Dicionário comercial da Nett: filtro determinístico por termos (palavras/expressões).
 * Não é classificação de aderência — essa é responsabilidade do Agente 03.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const Termo = z.object({
  termo: z.string().min(2),
  sinonimos: z.array(z.string().min(2)).default([]),
  categoria: z.string().optional(),
});

export const EsquemaDicionario = z.object({
  versao: z.string(),
  oficial: z.boolean(),
  descricao: z.string().optional(),
  termos: z.array(Termo).min(1),
  /** Expressões que, presentes, impedem a captura (ex.: "locação de imóvel"). */
  exclusoes: z.array(z.string()).default([]),
});
export type DicionarioComercial = z.infer<typeof EsquemaDicionario>;

export const normalizarTexto = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

type Padrao = { termo: string; regex: RegExp };

const compilar = (expressao: string) => {
  const n = normalizarTexto(expressao).replace(/ /g, '\\s+');
  return new RegExp(`(?:^|\\s)${n}(?:$|\\s)`);
};

export class Dicionario {
  private readonly padroes: Padrao[];
  private readonly exclusoes: RegExp[];

  constructor(readonly definicao: DicionarioComercial) {
    this.padroes = definicao.termos.flatMap((t) => [t.termo, ...t.sinonimos].map((e) => ({ termo: t.termo, regex: compilar(e) })));
    this.exclusoes = definicao.exclusoes.map(compilar);
  }

  /** Termos (canônicos) encontrados no texto; lista vazia se nenhum ou se houver exclusão. */
  avaliar(...textos: Array<string | null | undefined>): string[] {
    const alvo = ` ${normalizarTexto(textos.filter(Boolean).join(' '))} `;
    if (this.exclusoes.some((r) => r.test(alvo))) return [];
    const achados = new Set<string>();
    for (const p of this.padroes) if (p.regex.test(alvo)) achados.add(p.termo);
    return [...achados];
  }
}

export async function carregarDicionario(caminho: string): Promise<Dicionario> {
  let conteudo: string;
  try {
    conteudo = await readFile(caminho, 'utf8');
  } catch {
    throw new Error(
      `Dicionário comercial não encontrado em "${caminho}". Forneça o dicionário oficial da Nett (ver config/dicionario-comercial.exemplo.json).`,
    );
  }
  return new Dicionario(EsquemaDicionario.parse(JSON.parse(conteudo)));
}
