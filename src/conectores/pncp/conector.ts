/**
 * Conector PNCP — API de consulta oficial (https://pncp.gov.br/api/consulta) e API PNCP
 * (itens/arquivos). Base: cliente PNCP de Enzo47961/licitaflow-licitacoes (MIT).
 *
 * Coleta por data de ATUALIZAÇÃO (/v1/contratacoes/atualizacao), que traz compras novas e
 * alteradas no dia. Partição = modalidade × dia; tamanho de página máximo da API = 50.
 */
import type { DocumentoColetado, ItemColetado, OportunidadeColetada } from '../../contrato/normalizada.js';
import { ClienteHttp } from '../../http/cliente.js';
import {
  ESFERAS,
  MODALIDADES_PNCP,
  canceladaPorSituacao,
  isoBrasilia,
  limpar,
  linkPncp,
  numeroOuNull,
  partesControlePncp,
} from '../comum.js';
import { diasDaJanela, type ConectorLicitacoes, type EnriquecedorOportunidade, type Pagina, type Particao } from '../tipos.js';

export const PNCP_BASE = 'https://pncp.gov.br/api';
const TAMANHO_PAGINA = 50;

export type CompraPncpRaw = {
  numeroControlePNCP?: string;
  anoCompra?: number;
  sequencialCompra?: number;
  numeroCompra?: string | null;
  processo?: string | null;
  objetoCompra?: string | null;
  informacaoComplementar?: string | null;
  orgaoEntidade?: { cnpj?: string; razaoSocial?: string; esferaId?: string } | null;
  unidadeOrgao?: { nomeUnidade?: string; municipioNome?: string; ufSigla?: string } | null;
  modalidadeId?: number;
  modalidadeNome?: string;
  situacaoCompraNome?: string | null;
  srp?: boolean | null;
  amparoLegal?: { nome?: string; descricao?: string } | null;
  dataPublicacaoPncp?: string | null;
  dataAberturaProposta?: string | null;
  dataEncerramentoProposta?: string | null;
  dataAtualizacaoGlobal?: string | null;
  dataAtualizacao?: string | null;
  valorTotalEstimado?: number | null;
  valorTotalHomologado?: number | null;
  linkSistemaOrigem?: string | null;
};

type RespostaConsulta = {
  data?: CompraPncpRaw[];
  totalRegistros?: number;
  totalPaginas?: number;
  numeroPagina?: number;
  empty?: boolean;
};

export function normalizarCompraPncp(raw: CompraPncpRaw): OportunidadeColetada | null {
  const controle = raw.numeroControlePNCP;
  const partes = controle ? partesControlePncp(controle) : null;
  const cnpj = raw.orgaoEntidade?.cnpj ?? partes?.cnpj;
  const ano = raw.anoCompra ?? (partes ? Number(partes.ano) : undefined);
  const seq = raw.sequencialCompra ?? (partes ? Number(partes.sequencial) : undefined);
  const objeto = limpar(raw.objetoCompra);
  if (!controle || !cnpj || !ano || !seq || !objeto) return null;

  const modalidadeId = numeroOuNull(raw.modalidadeId);
  const situacao = limpar(raw.situacaoCompraNome);
  const amparo = raw.amparoLegal ? limpar([raw.amparoLegal.nome, raw.amparoLegal.descricao].filter(Boolean).join(' — ')) : null;
  const estimado = numeroOuNull(raw.valorTotalEstimado);

  return {
    fonte: 'pncp',
    idExterno: controle,
    urlOrigem: `${PNCP_BASE}/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`,
    numeroControlePncp: controle,
    numeroCompra: limpar(raw.numeroCompra),
    ano,
    sequencial: seq,
    processo: limpar(raw.processo),
    objeto,
    informacaoComplementar: limpar(raw.informacaoComplementar),
    orgaoCnpj: cnpj,
    orgaoNome: limpar(raw.orgaoEntidade?.razaoSocial) ?? 'Órgão não informado',
    unidadeNome: limpar(raw.unidadeOrgao?.nomeUnidade),
    municipio: limpar(raw.unidadeOrgao?.municipioNome),
    uf: limpar(raw.unidadeOrgao?.ufSigla),
    esfera: ESFERAS[raw.orgaoEntidade?.esferaId ?? ''] ?? null,
    modalidadeIdPncp: modalidadeId,
    modalidadeNome: (modalidadeId !== null ? MODALIDADES_PNCP[modalidadeId] : undefined) ?? limpar(raw.modalidadeNome) ?? 'Não informada',
    situacao,
    srp: typeof raw.srp === 'boolean' ? raw.srp : null,
    amparoLegal: amparo,
    dataPublicacao: isoBrasilia(raw.dataPublicacaoPncp),
    dataAberturaPropostas: isoBrasilia(raw.dataAberturaProposta),
    dataEncerramentoPropostas: isoBrasilia(raw.dataEncerramentoProposta),
    dataAtualizacaoFonte: isoBrasilia(raw.dataAtualizacaoGlobal ?? raw.dataAtualizacao),
    // 0 significa sigiloso/não informado no PNCP.
    valorEstimado: estimado && estimado > 0 ? estimado : null,
    valorHomologado: numeroOuNull(raw.valorTotalHomologado),
    linkOficial: linkPncp(cnpj, ano, seq),
    linkSistemaOrigem: limpar(raw.linkSistemaOrigem),
    cancelada: canceladaPorSituacao(situacao),
    bruto: raw,
  };
}

export function criarClientePncp(): ClienteHttp {
  // A API do PNCP recusa conexões acima de ~6 paralelas e responde 429 sob rajadas.
  return new ClienteHttp({ fonte: 'pncp', baseUrl: PNCP_BASE, intervaloMinMs: 700, concorrencia: 2, timeoutMs: 45_000, retentativas: 3 });
}

export class ConectorPncp implements ConectorLicitacoes, EnriquecedorOportunidade {
  readonly fonte = 'pncp' as const;

  constructor(
    private readonly modalidades: number[],
    private readonly http: ClienteHttp = criarClientePncp(),
  ) {}

  indisponibilidade(): string | null {
    return this.modalidades.length ? null : 'nenhuma modalidade configurada (PNCP_MODALIDADES)';
  }

  particoes(referencia: Date, janelaDias: number): Particao[] {
    return diasDaJanela(referencia, janelaDias).flatMap(({ dia, fechado }) =>
      this.modalidades.map((m) => ({
        chave: `atualizacao:${m}:${dia}`,
        params: { dia: dia.replace(/-/g, ''), modalidade: m },
        diaFechado: fechado,
      })),
    );
  }

  async listarPagina(particao: Particao, pagina: number): Promise<Pagina> {
    const corpo = await this.http.get<RespostaConsulta>('/consulta/v1/contratacoes/atualizacao', {
      params: {
        dataInicial: particao.params.dia,
        dataFinal: particao.params.dia,
        codigoModalidadeContratacao: particao.params.modalidade,
        pagina,
        tamanhoPagina: TAMANHO_PAGINA,
      },
    });
    const brutos = Array.isArray(corpo) ? [] : (corpo.data ?? []);
    const registros = brutos.map(normalizarCompraPncp).filter((r): r is OportunidadeColetada => r !== null);
    return {
      registros,
      pagina,
      totalPaginas: Array.isArray(corpo) ? 0 : (corpo.totalPaginas ?? 0),
      totalRegistros: Array.isArray(corpo) ? 0 : (corpo.totalRegistros ?? registros.length),
      invalidos: brutos.length - registros.length,
    };
  }

  /** Consulta pontual de uma compra (atualização de oportunidade já conhecida). */
  async obterCompra(controle: string): Promise<OportunidadeColetada | null> {
    const p = partesControlePncp(controle);
    if (!p) return null;
    const raw = await this.http.get<CompraPncpRaw>(`/consulta/v1/orgaos/${p.cnpj}/compras/${p.ano}/${p.sequencial}`, { retentativas: 1 });
    return normalizarCompraPncp(raw);
  }

  async documentos(controle: string): Promise<DocumentoColetado[]> {
    const p = partesControlePncp(controle);
    if (!p) return [];
    type ArquivoRaw = { url?: string; uri?: string; titulo?: string; tipoDocumentoNome?: string; sequencialDocumento?: number; dataPublicacaoPncp?: string; statusAtivo?: boolean };
    const brutos = await this.http.get<ArquivoRaw[]>(`/pncp/v1/orgaos/${p.cnpj}/compras/${p.ano}/${p.sequencial}/arquivos`, { ttlMs: 30 * 60_000 });
    return brutos
      .filter((a) => a.statusAtivo !== false && (a.url ?? a.uri))
      .map((a) => ({
        fonte: 'pncp' as const,
        idExterno: String(a.sequencialDocumento ?? 0),
        titulo: limpar(a.titulo) ?? 'Documento',
        tipo: limpar(a.tipoDocumentoNome) ?? 'Documento',
        url: (a.url ?? a.uri)!,
        publicadoEm: isoBrasilia(a.dataPublicacaoPncp),
      }));
  }

  async itens(controle: string): Promise<ItemColetado[]> {
    const p = partesControlePncp(controle);
    if (!p) return [];
    type ItemRaw = { numeroItem: number; descricao?: string; materialOuServico?: string; quantidade?: number; unidadeMedida?: string; valorUnitarioEstimado?: number | null; valorTotal?: number | null; orcamentoSigiloso?: boolean };
    const itens: ItemColetado[] = [];
    const porPagina = 100;
    for (let pagina = 1; pagina <= 20; pagina += 1) {
      const brutos = await this.http.get<ItemRaw[]>(`/pncp/v1/orgaos/${p.cnpj}/compras/${p.ano}/${p.sequencial}/itens`, {
        params: { pagina, tamanhoPagina: porPagina },
        ttlMs: 30 * 60_000,
      });
      for (const i of brutos) {
        const sigiloso = Boolean(i.orcamentoSigiloso);
        itens.push({
          numero: i.numeroItem,
          descricao: limpar(i.descricao) ?? '',
          tipo: i.materialOuServico === 'S' ? 'servico' : 'material',
          quantidade: numeroOuNull(i.quantidade),
          unidade: limpar(i.unidadeMedida),
          valorUnitarioEstimado: sigiloso ? null : numeroOuNull(i.valorUnitarioEstimado),
          valorTotalEstimado: sigiloso ? null : numeroOuNull(i.valorTotal),
        });
      }
      if (brutos.length < porPagina) break;
    }
    return itens;
  }
}
