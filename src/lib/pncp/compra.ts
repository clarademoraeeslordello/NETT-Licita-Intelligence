/**
 * Visão completa de uma compra: identificação + itens + arquivos + detalhe.
 *
 * Ordem de confiança das fontes, da mais estável para a menos:
 *   1. busca pelo número de controle  → órgão, objeto, prazos
 *   2. itens                          → valor estimado (soma dos itens)
 *   3. arquivos                       → PDF do edital
 *   4. /consulta (detalhe)            → amparo legal, processo, modo de disputa
 *
 * O PNCP falha de forma parcial com frequência; só a identificação é
 * obrigatória. O resto vira aviso na tela em vez de derrubar a página.
 */
import { AppError } from '../errors';
import { buscarCompraPorControle, listarArquivos, listarItens, obterCompra } from './api';
import type { ArquivoCompra, CompraDetalhe, ItemCompra, Oportunidade } from './types';

export type CompraCompleta = {
  oportunidade: Oportunidade;
  detalhe: CompraDetalhe | null;
  itens: ItemCompra[] | null;
  arquivos: ArquivoCompra[] | null;
  avisos: string[];
};

export async function carregarCompra(cnpj: string, ano: string, sequencial: string): Promise<CompraCompleta> {
  const [busca, detalhe, itens, arquivos] = await Promise.allSettled([
    buscarCompraPorControle(cnpj, ano, sequencial),
    // O detalhe é complementar: não seguramos a página por ele.
    Promise.race([
      obterCompra(cnpj, ano, sequencial),
      new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error('detalhe lento')), 4_000)),
    ]),
    // Página de detalhe: melhor mostrar o que chegou em ~12 s do que segurar o usuário.
    listarItens(cnpj, ano, sequencial, { paginas: 3, timeoutMs: 6_000 }),
    listarArquivos(cnpj, ano, sequencial, { timeoutMs: 6_000 }),
  ]);

  const doDetalhe = detalhe.status === 'fulfilled' ? detalhe.value : null;
  const base = (busca.status === 'fulfilled' ? busca.value : null) ?? doDetalhe?.oportunidade ?? null;

  if (!base) {
    const motivo = busca.status === 'rejected' ? busca.reason : null;
    if (motivo instanceof AppError && motivo.code === 'PNCP_UNAVAILABLE') throw motivo;
    throw new AppError('NOT_FOUND', 'Contratação não encontrada no PNCP.', {
      status: 404,
      hint: 'Confira o link ou procure a oportunidade novamente pelo Radar.',
    });
  }

  const listaItens = itens.status === 'fulfilled' ? itens.value : null;
  const somaItens = listaItens?.filter((item) => item.valorTotalEstimado !== null) ?? [];
  const oportunidade: Oportunidade = {
    ...base,
    valorEstimado:
      doDetalhe?.valorEstimado ??
      (somaItens.length ? somaItens.reduce((total, item) => total + (item.valorTotalEstimado ?? 0), 0) : base.valorEstimado),
    // A busca devolve a janela de propostas; o detalhe, quando existe, é a fonte oficial.
    aberturaPropostas: doDetalhe?.aberturaPropostas ?? base.aberturaPropostas,
    encerramentoPropostas: doDetalhe?.encerramentoPropostas ?? base.encerramentoPropostas,
  };

  const avisos: string[] = [];
  if (!listaItens) avisos.push('Os itens desta contratação não puderam ser carregados do PNCP agora.');
  if (arquivos.status === 'rejected') avisos.push('A lista de arquivos do edital não pôde ser carregada do PNCP agora.');

  let detalheSemOportunidade: CompraDetalhe | null = null;
  if (doDetalhe) {
    const { oportunidade: _ignorada, ...resto } = doDetalhe;
    detalheSemOportunidade = resto;
  }

  return {
    oportunidade,
    detalhe: detalheSemOportunidade,
    itens: listaItens,
    arquivos: arquivos.status === 'fulfilled' ? arquivos.value : null,
    avisos,
  };
}

/** Escolhe o arquivo que mais provavelmente é o edital em PDF. */
export function escolherArquivoEdital(arquivos: ArquivoCompra[]): ArquivoCompra | null {
  const pontuar = (arquivo: ArquivoCompra) => {
    let pontos = 0;
    if (/edital/i.test(arquivo.tipo)) pontos += 4;
    if (/edital/i.test(arquivo.titulo)) pontos += 2;
    if (/\.pdf$/i.test(arquivo.titulo)) pontos += 3;
    if (/\.(zip|rar|7z)$/i.test(arquivo.titulo)) pontos -= 5;
    if (/termo de refer|anexo|ata|aviso/i.test(arquivo.titulo)) pontos -= 1;
    return pontos;
  };
  return [...arquivos].sort((a, b) => pontuar(b) - pontuar(a) || a.sequencial - b.sequencial)[0] ?? null;
}
