/**
 * Consultas ao PNCP e normalização das respostas.
 *
 * Endpoints usados (todos públicos, sem autenticação):
 *   /search/                                          busca textual de editais
 *   /consulta/v1/orgaos/{cnpj}/compras/{ano}/{seq}    detalhe (valor, datas, amparo)
 *   /pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens  itens com valor estimado
 *   /pncp/v1/.../itens/{n}/resultados                 fornecedor vencedor e preço homologado
 *   /pncp/v1/.../arquivos                             PDFs do edital e anexos
 */
import { AppError } from '../errors';
import { pncpGet } from './client';
import type { ArquivoCompra, CompraDetalhe, ItemCompra, Oportunidade, ResultadoItem } from './types';

export { MODALIDADES } from './modalidades';
import { MODALIDADES } from './modalidades';

const ESFERAS: Record<string, string> = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital' };

export type StatusBusca = 'recebendo_proposta' | 'encerradas';

export type BuscaInput = {
  termo: string;
  status: StatusBusca;
  ufs?: string[];
  modalidades?: number[];
  pagina?: number;
  tamanho?: number;
};

type SearchItem = {
  title?: string;
  description?: string;
  item_url?: string;
  ano?: string;
  numero_sequencial?: string;
  numero_controle_pncp?: string;
  orgao_cnpj?: string;
  orgao_nome?: string;
  unidade_nome?: string;
  municipio_nome?: string;
  uf?: string;
  esfera_id?: string;
  modalidade_licitacao_id?: string;
  modalidade_licitacao_nome?: string;
  situacao_nome?: string;
  data_publicacao_pncp?: string;
  data_inicio_vigencia?: string | null;
  data_fim_vigencia?: string | null;
  valor_global?: number | null;
  tem_resultado?: boolean;
  cancelado?: boolean;
};

/** Datas do PNCP chegam sem fuso e em horário de Brasília. */
export function toIsoBrasilia(value: string | null | undefined): string | null {
  if (!value) return null;
  const base = value.replace(/\.\d+$/, '');
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(base)) return new Date(base).toISOString();
  const withSeconds = /T\d{2}:\d{2}$/.test(base) ? `${base}:00` : /^\d{4}-\d{2}-\d{2}$/.test(base) ? `${base}T00:00:00` : base;
  const date = new Date(`${withSeconds}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const linkPncp = (cnpj: string, ano: string | number, sequencial: string | number) =>
  `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${sequencial}`;

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

function normalizeSearchItem(item: SearchItem): Oportunidade | null {
  // item_url = /compras/{cnpj}/{ano}/{sequencial}
  const match = /\/compras\/(\d{14})\/(\d{4})\/(\d+)/.exec(item.item_url ?? '');
  const cnpj = item.orgao_cnpj ?? match?.[1];
  const ano = item.ano ?? match?.[2];
  const sequencial = item.numero_sequencial ?? match?.[3];
  if (!cnpj || !ano || !sequencial) return null;

  const modalidadeId = Number(item.modalidade_licitacao_id ?? 0);
  return {
    id: `${cnpj}-${ano}-${sequencial}`,
    cnpj,
    ano,
    sequencial,
    numeroControle: item.numero_controle_pncp ?? '',
    titulo: clean(item.title),
    objeto: clean(item.description),
    orgao: clean(item.orgao_nome),
    unidade: clean(item.unidade_nome),
    municipio: clean(item.municipio_nome),
    uf: item.uf ?? '',
    esfera: ESFERAS[item.esfera_id ?? ''] ?? '—',
    modalidadeId,
    modalidade: MODALIDADES[modalidadeId] ?? (clean(item.modalidade_licitacao_nome) || '—'),
    situacao: clean(item.situacao_nome),
    publicadaEm: toIsoBrasilia(item.data_publicacao_pncp),
    // Na busca de editais, "vigência" é a janela de recebimento de propostas.
    aberturaPropostas: toIsoBrasilia(item.data_inicio_vigencia),
    encerramentoPropostas: toIsoBrasilia(item.data_fim_vigencia),
    valorEstimado: typeof item.valor_global === 'number' ? item.valor_global : null,
    temResultado: Boolean(item.tem_resultado),
    cancelado: Boolean(item.cancelado),
    linkPncp: linkPncp(cnpj, ano, sequencial),
  };
}

export async function buscarEditais(input: BuscaInput): Promise<{ total: number; itens: Oportunidade[] }> {
  const params = new URLSearchParams({
    q: input.termo,
    tipos_documento: 'edital',
    ordenacao: '-data',
    pagina: String(input.pagina ?? 1),
    tam_pagina: String(input.tamanho ?? 30),
    status: input.status,
  });
  if (input.ufs?.length) params.set('ufs', input.ufs.join('|'));
  if (input.modalidades?.length) params.set('modalidades', input.modalidades.join('|'));

  const body = await pncpGet<{ items?: SearchItem[]; total?: number }>(`/search/?${params}`, { ttlMs: 10 * 60_000 });
  const itens = (body.items ?? []).map(normalizeSearchItem).filter((item): item is Oportunidade => item !== null);
  return { total: body.total ?? itens.length, itens };
}

/** Número de controle PNCP de uma compra: {cnpj}-1-{sequencial com 6 dígitos}/{ano}. */
export const numeroControleCompra = (cnpj: string, ano: string, sequencial: string) =>
  `${cnpj}-1-${sequencial.padStart(6, '0')}/${ano}`;

/**
 * Localiza uma compra pela busca textual (sem limite agressivo de requisições),
 * usando o número de controle como consulta exata.
 */
export async function buscarCompraPorControle(cnpj: string, ano: string, sequencial: string): Promise<Oportunidade | null> {
  const controle = numeroControleCompra(cnpj, ano, sequencial);
  const params = new URLSearchParams({ q: controle, tipos_documento: 'edital', pagina: '1', tam_pagina: '5' });
  const body = await pncpGet<{ items?: SearchItem[] }>(`/search/?${params}`, { ttlMs: 30 * 60_000 });
  const encontrado = (body.items ?? []).find((item) => item.numero_controle_pncp === controle);
  return encontrado ? normalizeSearchItem(encontrado) : null;
}

type CompraRaw = {
  numeroControlePNCP?: string;
  objetoCompra?: string;
  orgaoEntidade?: { cnpj?: string; razaoSocial?: string; esferaId?: string } | null;
  unidadeOrgao?: { nomeUnidade?: string; municipioNome?: string; ufSigla?: string } | null;
  modalidadeId?: number;
  modalidadeNome?: string;
  dataPublicacaoPncp?: string | null;
  existeResultado?: boolean;
  tipoInstrumentoConvocatorioNome?: string | null;
  valorTotalEstimado?: number | null;
  valorTotalHomologado?: number | null;
  processo?: string | null;
  numeroCompra?: string | null;
  amparoLegal?: { nome?: string; descricao?: string } | null;
  modoDisputaNome?: string | null;
  srp?: boolean;
  informacaoComplementar?: string | null;
  linkSistemaOrigem?: string | null;
  dataAberturaProposta?: string | null;
  dataEncerramentoProposta?: string | null;
  situacaoCompraNome?: string | null;
  orcamentoSigilosoCodigo?: number | null;
};

/**
 * Disjuntor do endpoint /consulta: ele responde 429 com facilidade e, depois
 * disso, deixa as conexões penduradas por minutos. Após uma falha, paramos de
 * chamá-lo por um tempo e a interface segue com os dados da busca + itens.
 */
const disjuntor = globalThis as unknown as { __pncpConsultaBloqueadaAte?: number };
const PAUSA_CONSULTA_MS = 5 * 60_000;

export async function obterCompra(cnpj: string, ano: string, sequencial: string): Promise<CompraDetalhe & { oportunidade: Oportunidade }> {
  if ((disjuntor.__pncpConsultaBloqueadaAte ?? 0) > Date.now()) {
    throw new AppError('PNCP_UNAVAILABLE', 'Detalhe da compra temporariamente indisponível no PNCP.', { status: 503 });
  }
  let raw: CompraRaw;
  try {
    raw = await pncpGet<CompraRaw>(`/consulta/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`, {
      ttlMs: 30 * 60_000,
      timeoutMs: 8_000,
      retries: 0,
    });
  } catch (error) {
    if (!(error instanceof AppError && error.code === 'NOT_FOUND')) {
      disjuntor.__pncpConsultaBloqueadaAte = Date.now() + PAUSA_CONSULTA_MS;
    }
    throw error;
  }
  const amparo = raw.amparoLegal ? [raw.amparoLegal.nome, raw.amparoLegal.descricao].filter(Boolean).join(' — ') : null;
  // Código 1 = "compra sem sigilo". Qualquer outro indica orçamento sigiloso (total ou parcial).
  const sigiloso = typeof raw.orcamentoSigilosoCodigo === 'number' && raw.orcamentoSigilosoCodigo !== 1;
  const valor = typeof raw.valorTotalEstimado === 'number' && raw.valorTotalEstimado > 0 ? raw.valorTotalEstimado : null;

  const modalidadeId = Number(raw.modalidadeId ?? 0);
  const situacao = clean(raw.situacaoCompraNome) || null;
  const oportunidade: Oportunidade = {
    id: `${cnpj}-${ano}-${sequencial}`,
    cnpj,
    ano,
    sequencial,
    numeroControle: raw.numeroControlePNCP ?? '',
    titulo: [clean(raw.tipoInstrumentoConvocatorioNome) || 'Edital', raw.numeroCompra ? `nº ${clean(raw.numeroCompra)}/${ano}` : '']
      .filter(Boolean)
      .join(' '),
    objeto: clean(raw.objetoCompra),
    orgao: clean(raw.orgaoEntidade?.razaoSocial),
    unidade: clean(raw.unidadeOrgao?.nomeUnidade),
    municipio: clean(raw.unidadeOrgao?.municipioNome),
    uf: raw.unidadeOrgao?.ufSigla ?? '',
    esfera: ESFERAS[raw.orgaoEntidade?.esferaId ?? ''] ?? '—',
    modalidadeId,
    modalidade: MODALIDADES[modalidadeId] ?? (clean(raw.modalidadeNome) || '—'),
    situacao: situacao ?? '',
    publicadaEm: toIsoBrasilia(raw.dataPublicacaoPncp),
    aberturaPropostas: toIsoBrasilia(raw.dataAberturaProposta),
    encerramentoPropostas: toIsoBrasilia(raw.dataEncerramentoProposta),
    valorEstimado: valor,
    temResultado: Boolean(raw.existeResultado),
    cancelado: /cancelad|revogad|anulad/i.test(situacao ?? ''),
    linkPncp: linkPncp(cnpj, ano, sequencial),
  };

  return {
    oportunidade,
    valorEstimado: valor,
    valorHomologado: typeof raw.valorTotalHomologado === 'number' ? raw.valorTotalHomologado : null,
    processo: clean(raw.processo) || null,
    numeroCompra: clean(raw.numeroCompra) || null,
    amparoLegal: amparo || null,
    modoDisputa: clean(raw.modoDisputaNome) || null,
    srp: Boolean(raw.srp),
    informacaoComplementar: clean(raw.informacaoComplementar) || null,
    linkSistemaOrigem: clean(raw.linkSistemaOrigem) || null,
    aberturaPropostas: toIsoBrasilia(raw.dataAberturaProposta),
    encerramentoPropostas: toIsoBrasilia(raw.dataEncerramentoProposta),
    situacao,
    orcamentoSigiloso: sigiloso,
  };
}

type ItemRaw = {
  numeroItem: number;
  descricao?: string;
  materialOuServico?: string;
  quantidade?: number;
  unidadeMedida?: string;
  valorUnitarioEstimado?: number | null;
  valorTotal?: number | null;
  criterioJulgamentoNome?: string | null;
  tipoBeneficioNome?: string | null;
  situacaoCompraItemNome?: string | null;
  temResultado?: boolean;
  orcamentoSigiloso?: boolean;
};

const ITENS_POR_PAGINA = 100;
const MAX_PAGINAS_ITENS = 5;

export async function listarItens(
  cnpj: string,
  ano: string,
  sequencial: string,
  opcoes: { paginas?: number; timeoutMs?: number } = {},
): Promise<ItemCompra[]> {
  const itens: ItemCompra[] = [];
  for (let pagina = 1; pagina <= (opcoes.paginas ?? MAX_PAGINAS_ITENS); pagina += 1) {
    const raw = await pncpGet<ItemRaw[]>(
      `/pncp/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens?pagina=${pagina}&tamanhoPagina=${ITENS_POR_PAGINA}`,
      { ttlMs: 30 * 60_000, ...(opcoes.timeoutMs ? { timeoutMs: opcoes.timeoutMs, retries: 0 } : {}) },
    );
    for (const item of raw) {
      const sigiloso = Boolean(item.orcamentoSigiloso);
      itens.push({
        numero: item.numeroItem,
        descricao: clean(item.descricao),
        tipo: item.materialOuServico === 'S' ? 'Serviço' : 'Material',
        quantidade: Number(item.quantidade ?? 0),
        unidade: clean(item.unidadeMedida) || 'UN',
        valorUnitarioEstimado: !sigiloso && typeof item.valorUnitarioEstimado === 'number' ? item.valorUnitarioEstimado : null,
        valorTotalEstimado: !sigiloso && typeof item.valorTotal === 'number' ? item.valorTotal : null,
        criterioJulgamento: clean(item.criterioJulgamentoNome) || null,
        beneficio: clean(item.tipoBeneficioNome) || null,
        situacao: clean(item.situacaoCompraItemNome) || null,
        temResultado: Boolean(item.temResultado),
      });
    }
    if (raw.length < ITENS_POR_PAGINA) break;
  }
  return itens;
}

type ArquivoRaw = {
  url?: string;
  uri?: string;
  titulo?: string;
  tipoDocumentoNome?: string;
  sequencialDocumento?: number;
  dataPublicacaoPncp?: string;
  statusAtivo?: boolean;
};

export async function listarArquivos(cnpj: string, ano: string, sequencial: string, opcoes: { timeoutMs?: number } = {}): Promise<ArquivoCompra[]> {
  const raw = await pncpGet<ArquivoRaw[]>(`/pncp/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/arquivos`, {
    ttlMs: 30 * 60_000,
    ...(opcoes.timeoutMs ? { timeoutMs: opcoes.timeoutMs, retries: 1 } : {}),
  });
  return raw
    .map((arquivo) => ({
      sequencial: Number(arquivo.sequencialDocumento ?? 0),
      titulo: clean(arquivo.titulo) || 'Documento',
      tipo: clean(arquivo.tipoDocumentoNome) || 'Documento',
      url: arquivo.url ?? arquivo.uri ?? '',
      publicadoEm: toIsoBrasilia(arquivo.dataPublicacaoPncp),
      ativo: arquivo.statusAtivo !== false,
    }))
    .filter((arquivo) => arquivo.url && arquivo.ativo);
}

type ResultadoRaw = {
  nomeRazaoSocialFornecedor?: string;
  niFornecedor?: string;
  porteFornecedorNome?: string | null;
  valorUnitarioHomologado?: number;
  quantidadeHomologada?: number;
  percentualDesconto?: number | null;
  dataResultado?: string | null;
  aplicacaoBeneficioMeEpp?: boolean;
  dataCancelamento?: string | null;
};

export async function listarResultados(
  cnpj: string,
  ano: string,
  sequencial: string,
  numeroItem: number,
): Promise<ResultadoItem[]> {
  const raw = await pncpGet<ResultadoRaw[]>(
    `/pncp/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens/${numeroItem}/resultados`,
    { ttlMs: 60 * 60_000, timeoutMs: 20_000, retries: 1 },
  );
  return raw
    .filter((resultado) => !resultado.dataCancelamento && Number(resultado.valorUnitarioHomologado) > 0)
    .map((resultado) => ({
      fornecedor: clean(resultado.nomeRazaoSocialFornecedor) || 'Fornecedor não informado',
      documentoFornecedor: resultado.niFornecedor ?? '',
      porte: clean(resultado.porteFornecedorNome) || null,
      valorUnitario: Number(resultado.valorUnitarioHomologado),
      quantidade: Number(resultado.quantidadeHomologada ?? 0),
      percentualDesconto: typeof resultado.percentualDesconto === 'number' ? resultado.percentualDesconto : null,
      dataResultado: resultado.dataResultado ?? null,
      meEpp: Boolean(resultado.aplicacaoBeneficioMeEpp),
    }));
}

/** Valida os três segmentos de identificação de uma compra vindos da URL. */
export function parseCompraId(cnpj: string, ano: string, sequencial: string): { cnpj: string; ano: string; sequencial: string } | null {
  if (!/^\d{14}$/.test(cnpj) || !/^\d{4}$/.test(ano) || !/^\d{1,7}$/.test(sequencial)) return null;
  return { cnpj, ano, sequencial };
}
