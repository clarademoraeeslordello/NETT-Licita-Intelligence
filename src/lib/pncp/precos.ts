/**
 * Inteligência de preços: coleta preços HOMOLOGADOS (o valor que de fato venceu)
 * de itens parecidos em licitações já encerradas no PNCP.
 *
 * Caminho no PNCP: busca de editais encerrados com resultado → itens de cada
 * compra → filtra os itens cuja descrição contém a consulta → resultados do
 * item (fornecedor vencedor, porte, preço unitário homologado).
 *
 * O endpoint de resultados é lento (2–6 s por item), então a coleta é um
 * gerador: cada lote vira eventos que a rota transmite em NDJSON e a tela
 * desenha as amostras conforme chegam.
 */
import { buscarEditais, listarItens, listarResultados } from './api';
import { mapLimit } from './client';
import { amostraPrecos, AMOSTRA_CAPTURADA_EM } from './amostra';
import type { AmostraPreco, FonteDados, ItemCompra, Oportunidade } from './types';
import { itemCasa, normalizar, palavrasChave } from '../plataforma/texto';

export type EventoPrecos =
  | { tipo: 'inicio'; consulta: string; fonte: FonteDados; capturadoEm?: string }
  | { tipo: 'progresso'; mensagem: string; concluido: number; total: number }
  | { tipo: 'amostras'; amostras: AmostraPreco[] }
  | { tipo: 'fim'; comprasAnalisadas: number; amostras: number; duracaoMs: number; fonte: FonteDados }
  | { tipo: 'erro'; mensagem: string; dica?: string };

export type PrecosInput = { consulta: string; ufs: string[] };

const MAX_COMPRAS = 24;
const MAX_ITENS_POR_COMPRA = 3;
const MAX_AMOSTRAS = 60;
const LOTE = 4;
const ORCAMENTO_MS = 48_000;

type CacheEntry = { expiresAt: number; amostras: AmostraPreco[]; compras: number };
const globalRef = globalThis as unknown as { __precosCache?: Map<string, CacheEntry> };
const cache = globalRef.__precosCache ?? (globalRef.__precosCache = new Map());

export const chavePrecos = (input: PrecosInput) => `${normalizar(input.consulta)}|${[...input.ufs].sort().join(',')}`;

function montarAmostra(compra: Oportunidade, item: ItemCompra, resultado: Awaited<ReturnType<typeof listarResultados>>[number]): AmostraPreco {
  const estimado = item.valorUnitarioEstimado;
  const desconto =
    estimado && estimado > 0 ? Math.round(((estimado - resultado.valorUnitario) / estimado) * 1000) / 10 : null;
  return {
    id: `${compra.id}-${item.numero}-${resultado.documentoFornecedor || resultado.fornecedor}`,
    descricao: item.descricao,
    unidade: item.unidade,
    quantidade: resultado.quantidade || item.quantidade,
    valorEstimadoUnitario: estimado,
    valorHomologadoUnitario: resultado.valorUnitario,
    desconto,
    fornecedor: resultado.fornecedor,
    documentoFornecedor: resultado.documentoFornecedor,
    porte: resultado.porte,
    dataResultado: resultado.dataResultado,
    orgao: compra.orgao,
    municipio: compra.municipio,
    uf: compra.uf,
    modalidade: compra.modalidade,
    linkPncp: compra.linkPncp,
  };
}

export async function* coletarPrecos(input: PrecosInput, signal?: AbortSignal): AsyncGenerator<EventoPrecos> {
  const inicio = Date.now();
  const palavras = palavrasChave(input.consulta);
  if (palavras.length === 0) {
    yield { tipo: 'erro', mensagem: 'Descreva o item que você quer precificar.', dica: 'Ex.: "notebook i5 8gb", "papel A4", "cadeira giratória".' };
    return;
  }

  const chave = chavePrecos(input);
  const emCache = cache.get(chave);
  if (emCache && emCache.expiresAt > Date.now()) {
    yield { tipo: 'inicio', consulta: input.consulta, fonte: 'pncp' };
    yield { tipo: 'amostras', amostras: emCache.amostras };
    yield { tipo: 'fim', comprasAnalisadas: emCache.compras, amostras: emCache.amostras.length, duracaoMs: Date.now() - inicio, fonte: 'pncp' };
    return;
  }

  // 1. Compras encerradas que já têm resultado publicado.
  const compras: Oportunidade[] = [];
  let buscaFalhou = false;
  for (let pagina = 1; pagina <= 3 && compras.length < MAX_COMPRAS; pagina += 1) {
    try {
      const { itens } = await buscarEditais({ termo: input.consulta, status: 'encerradas', ufs: input.ufs, pagina, tamanho: 40 });
      compras.push(...itens.filter((op) => op.temResultado && !op.cancelado));
      if (itens.length < 40) break;
    } catch {
      buscaFalhou = pagina === 1;
      break;
    }
  }

  if (buscaFalhou) {
    const reserva = amostraPrecos[normalizar(input.consulta)];
    if (reserva?.length) {
      yield { tipo: 'inicio', consulta: input.consulta, fonte: 'amostra', capturadoEm: AMOSTRA_CAPTURADA_EM };
      yield { tipo: 'amostras', amostras: reserva };
      yield { tipo: 'fim', comprasAnalisadas: 0, amostras: reserva.length, duracaoMs: Date.now() - inicio, fonte: 'amostra' };
      return;
    }
    yield { tipo: 'erro', mensagem: 'O PNCP não respondeu à busca.', dica: 'O portal oficial está instável. Tente novamente em alguns instantes.' };
    return;
  }

  const alvo = compras.slice(0, MAX_COMPRAS);
  yield { tipo: 'inicio', consulta: input.consulta, fonte: 'pncp' };

  if (alvo.length === 0) {
    yield { tipo: 'fim', comprasAnalisadas: 0, amostras: 0, duracaoMs: Date.now() - inicio, fonte: 'pncp' };
    return;
  }

  yield { tipo: 'progresso', mensagem: `${alvo.length} licitações encerradas com resultado encontradas`, concluido: 0, total: alvo.length };

  // 2 e 3. Em lotes: itens da compra → itens que casam → resultado de cada um.
  const coletadas: AmostraPreco[] = [];
  let analisadas = 0;

  for (let indice = 0; indice < alvo.length; indice += LOTE) {
    if (signal?.aborted || Date.now() - inicio > ORCAMENTO_MS || coletadas.length >= MAX_AMOSTRAS) break;
    const lote = alvo.slice(indice, indice + LOTE);

    const porCompra = await mapLimit(lote, LOTE, async (compra) => {
      const itens = (await listarItens(compra.cnpj, compra.ano, compra.sequencial))
        .filter((item) => item.temResultado && itemCasa(item.descricao, palavras))
        .slice(0, MAX_ITENS_POR_COMPRA);

      const resultados = await mapLimit(itens, MAX_ITENS_POR_COMPRA, (item) =>
        listarResultados(compra.cnpj, compra.ano, compra.sequencial, item.numero),
      );

      const amostras: AmostraPreco[] = [];
      resultados.forEach((resultado, posicao) => {
        if (resultado.status !== 'fulfilled') return;
        for (const vencedor of resultado.value) amostras.push(montarAmostra(compra, itens[posicao], vencedor));
      });
      return amostras;
    });

    analisadas += lote.length;
    const novas = porCompra.flatMap((resultado) => (resultado.status === 'fulfilled' ? resultado.value : []));
    coletadas.push(...novas);

    if (novas.length) yield { tipo: 'amostras', amostras: novas };
    yield {
      tipo: 'progresso',
      mensagem: `${analisadas} de ${alvo.length} licitações lidas · ${coletadas.length} preço(s) vencedor(es)`,
      concluido: analisadas,
      total: alvo.length,
    };
  }

  if (!signal?.aborted) cache.set(chave, { expiresAt: Date.now() + 60 * 60_000, amostras: coletadas, compras: analisadas });
  yield { tipo: 'fim', comprasAnalisadas: analisadas, amostras: coletadas.length, duracaoMs: Date.now() - inicio, fonte: 'pncp' };
}
