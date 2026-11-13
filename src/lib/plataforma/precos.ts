/**
 * Estatística das amostras de preço vencedor.
 *
 * As amostras chegam em unidades diferentes (UN, CX, KIT…). Misturar unidades
 * produz uma "mediana" sem sentido, então as estatísticas usam apenas a unidade
 * predominante — e a interface informa quantas amostras ficaram de fora.
 */
import type { AmostraPreco } from '../pncp/types';

export type EstatisticaPrecos = {
  unidade: string;
  amostras: number;
  descartadasPorUnidade: number;
  minimo: number;
  p25: number;
  mediana: number;
  p75: number;
  maximo: number;
  descontoMedio: number | null;
  participacaoMeEpp: number | null;
  fornecedores: Array<{ nome: string; documento: string; vitorias: number; ticketMedio: number }>;
  /** Histograma para o gráfico de distribuição. */
  faixas: Array<{ de: number; ate: number; quantidade: number }>;
};

function quantil(ordenados: number[], q: number): number {
  if (ordenados.length === 1) return ordenados[0];
  const posicao = (ordenados.length - 1) * q;
  const base = Math.floor(posicao);
  const resto = posicao - base;
  const proximo = ordenados[base + 1] ?? ordenados[base];
  return ordenados[base] + resto * (proximo - ordenados[base]);
}

const normalizarUnidade = (unidade: string) => unidade.trim().toUpperCase().replace(/\.$/, '').replace(/^UNIDADE$|^UND$|^UNID$/, 'UN');

export function estatisticasPrecos(amostras: AmostraPreco[], numeroFaixas = 8): EstatisticaPrecos | null {
  if (amostras.length === 0) return null;

  const porUnidade = new Map<string, AmostraPreco[]>();
  for (const amostra of amostras) {
    const unidade = normalizarUnidade(amostra.unidade);
    porUnidade.set(unidade, [...(porUnidade.get(unidade) ?? []), amostra]);
  }
  const [unidade, grupo] = [...porUnidade.entries()].sort((a, b) => b[1].length - a[1].length)[0];

  const valores = grupo.map((amostra) => amostra.valorHomologadoUnitario).sort((a, b) => a - b);
  const descontos = grupo.map((amostra) => amostra.desconto).filter((valor): valor is number => valor !== null);
  const comPorte = grupo.filter((amostra) => amostra.porte);
  const meEpp = comPorte.filter((amostra) => /^(ME|EPP)$/i.test(amostra.porte ?? ''));

  const vencedores = new Map<string, { nome: string; documento: string; vitorias: number; soma: number }>();
  for (const amostra of grupo) {
    const chave = amostra.documentoFornecedor || amostra.fornecedor;
    const atual = vencedores.get(chave) ?? { nome: amostra.fornecedor, documento: amostra.documentoFornecedor, vitorias: 0, soma: 0 };
    atual.vitorias += 1;
    atual.soma += amostra.valorHomologadoUnitario;
    vencedores.set(chave, atual);
  }

  const minimo = valores[0];
  const maximo = valores[valores.length - 1];
  const largura = (maximo - minimo) / numeroFaixas || 1;
  const faixas = Array.from({ length: maximo === minimo ? 1 : numeroFaixas }, (_, indice) => ({
    de: minimo + indice * largura,
    ate: minimo + (indice + 1) * largura,
    quantidade: 0,
  }));
  for (const valor of valores) {
    const indice = Math.min(faixas.length - 1, Math.floor((valor - minimo) / largura));
    faixas[indice].quantidade += 1;
  }

  return {
    unidade,
    amostras: grupo.length,
    descartadasPorUnidade: amostras.length - grupo.length,
    minimo,
    p25: quantil(valores, 0.25),
    mediana: quantil(valores, 0.5),
    p75: quantil(valores, 0.75),
    maximo,
    descontoMedio: descontos.length ? descontos.reduce((a, b) => a + b, 0) / descontos.length : null,
    participacaoMeEpp: comPorte.length ? meEpp.length / comPorte.length : null,
    fornecedores: [...vencedores.values()]
      .map((item) => ({ nome: item.nome, documento: item.documento, vitorias: item.vitorias, ticketMedio: item.soma / item.vitorias }))
      .sort((a, b) => b.vitorias - a.vitorias || a.ticketMedio - b.ticketMedio)
      .slice(0, 6),
    faixas,
  };
}
