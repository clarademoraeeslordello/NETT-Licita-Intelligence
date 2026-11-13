/**
 * Conector Compras.gov.br — API de Dados Abertos (https://dadosabertos.compras.gov.br),
 * módulo "contratações" (Lei 14.133). Fonte independente do PNCP: cliente HTTP, paginação,
 * limitador e normalização próprios. A deduplicação com o PNCP usa `numeroControlePNCP`.
 *
 * Observações verificadas na API em 13/11/2026:
 *  - `codigoModalidade` é obrigatório e usa a codificação do Compras.gov (5 = Pregão eletrônico,
 *    6 = Dispensa), diferente da do PNCP (campo `modalidadeIdPncp`).
 *  - `dataPublicacaoPncpFinal` é EXCLUSIVA: o dia D exige o intervalo [D, D+1].
 *  - `tamanhoPagina` máximo = 500.
 */
import type { OportunidadeColetada } from '../../contrato/normalizada.js';
import { ClienteHttp } from '../../http/cliente.js';
import { ESFERAS, MODALIDADES_PNCP, canceladaPorSituacao, isoBrasilia, limpar, linkPncp, numeroOuNull, partesControlePncp } from '../comum.js';
import { diasDaJanela, type ConectorLicitacoes, type Pagina, type Particao } from '../tipos.js';

export const COMPRASGOV_BASE = 'https://dadosabertos.compras.gov.br';
const TAMANHO_PAGINA = 500;

export type ContratacaoComprasGovRaw = {
  idCompra?: string;
  numeroControlePNCP?: string | null;
  anoCompraPncp?: number;
  sequencialCompraPncp?: number;
  orgaoEntidadeCnpj?: string;
  orgaoEntidadeRazaoSocial?: string;
  orgaoEntidadeEsferaId?: string;
  unidadeOrgaoNomeUnidade?: string;
  unidadeOrgaoUfSigla?: string;
  unidadeOrgaoMunicipioNome?: string;
  numeroCompra?: string | null;
  modalidadeIdPncp?: number;
  codigoModalidade?: number;
  modalidadeNome?: string;
  srp?: boolean | null;
  amparoLegalNome?: string | null;
  amparoLegalDescricao?: string | null;
  informacaoComplementar?: string | null;
  processo?: string | null;
  objetoCompra?: string | null;
  situacaoCompraNomePncp?: string | null;
  valorTotalEstimado?: number | null;
  valorTotalHomologado?: number | null;
  dataPublicacaoPncp?: string | null;
  dataAtualizacaoPncp?: string | null;
  dataAberturaPropostaPncp?: string | null;
  dataEncerramentoPropostaPncp?: string | null;
  contratacaoExcluida?: boolean;
};

type Resposta = { resultado?: ContratacaoComprasGovRaw[]; totalRegistros?: number; totalPaginas?: number };

export function normalizarContratacaoComprasGov(raw: ContratacaoComprasGovRaw): OportunidadeColetada | null {
  const objeto = limpar(raw.objetoCompra);
  const idExterno = raw.idCompra ?? raw.numeroControlePNCP ?? null;
  if (!objeto || !idExterno) return null;
  const controle = limpar(raw.numeroControlePNCP);
  const partes = controle ? partesControlePncp(controle) : null;
  const cnpj = limpar(raw.orgaoEntidadeCnpj) ?? partes?.cnpj ?? null;
  const ano = raw.anoCompraPncp ?? (partes ? Number(partes.ano) : null);
  const seq = raw.sequencialCompraPncp ?? (partes ? Number(partes.sequencial) : null);
  const modalidadeId = numeroOuNull(raw.modalidadeIdPncp);
  const situacao = limpar(raw.situacaoCompraNomePncp);
  const estimado = numeroOuNull(raw.valorTotalEstimado);
  const linkOficial = cnpj && ano && seq ? linkPncp(cnpj, ano, seq) : `${COMPRASGOV_BASE}/modulo-contratacoes/1_consultarContratacoes_PNCP_14133_id?tipo=idCompra&codigo=${idExterno}`;

  return {
    fonte: 'comprasgov',
    idExterno,
    urlOrigem: `${COMPRASGOV_BASE}/modulo-contratacoes/1_consultarContratacoes_PNCP_14133_id?tipo=idCompra&codigo=${encodeURIComponent(idExterno)}`,
    numeroControlePncp: controle,
    numeroCompra: limpar(raw.numeroCompra),
    ano,
    sequencial: seq,
    processo: limpar(raw.processo),
    objeto,
    informacaoComplementar: limpar(raw.informacaoComplementar),
    orgaoCnpj: cnpj,
    orgaoNome: limpar(raw.orgaoEntidadeRazaoSocial) ?? 'Órgão não informado',
    unidadeNome: limpar(raw.unidadeOrgaoNomeUnidade),
    municipio: limpar(raw.unidadeOrgaoMunicipioNome),
    uf: limpar(raw.unidadeOrgaoUfSigla),
    esfera: ESFERAS[raw.orgaoEntidadeEsferaId ?? ''] ?? null,
    modalidadeIdPncp: modalidadeId,
    modalidadeNome: (modalidadeId !== null ? MODALIDADES_PNCP[modalidadeId] : undefined) ?? limpar(raw.modalidadeNome) ?? 'Não informada',
    situacao,
    srp: typeof raw.srp === 'boolean' ? raw.srp : null,
    amparoLegal: limpar([raw.amparoLegalNome, raw.amparoLegalDescricao].filter(Boolean).join(' — ')),
    dataPublicacao: isoBrasilia(raw.dataPublicacaoPncp),
    dataAberturaPropostas: isoBrasilia(raw.dataAberturaPropostaPncp),
    dataEncerramentoPropostas: isoBrasilia(raw.dataEncerramentoPropostaPncp),
    dataAtualizacaoFonte: isoBrasilia(raw.dataAtualizacaoPncp),
    valorEstimado: estimado && estimado > 0 ? estimado : null,
    valorHomologado: numeroOuNull(raw.valorTotalHomologado),
    linkOficial,
    linkSistemaOrigem: null,
    cancelada: Boolean(raw.contratacaoExcluida) || canceladaPorSituacao(situacao),
    bruto: raw,
  };
}

const diaSeguinte = (dia: string) => new Date(Date.parse(`${dia}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export class ConectorComprasGov implements ConectorLicitacoes {
  readonly fonte = 'comprasgov' as const;

  constructor(
    private readonly modalidades: number[],
    private readonly http: ClienteHttp = new ClienteHttp({
      fonte: 'comprasgov',
      baseUrl: COMPRASGOV_BASE,
      intervaloMinMs: 1000,
      concorrencia: 1,
      timeoutMs: 60_000,
      retentativas: 3,
    }),
  ) {}

  indisponibilidade(): string | null {
    return this.modalidades.length ? null : 'nenhuma modalidade configurada (COMPRASGOV_MODALIDADES)';
  }

  particoes(referencia: Date, janelaDias: number): Particao[] {
    return diasDaJanela(referencia, janelaDias).flatMap(({ dia, fechado }) =>
      this.modalidades.map((m) => ({ chave: `publicacao:${m}:${dia}`, params: { dia, modalidade: m }, diaFechado: fechado })),
    );
  }

  async listarPagina(particao: Particao, pagina: number): Promise<Pagina> {
    const dia = String(particao.params.dia);
    const corpo = await this.http.get<Resposta>('/modulo-contratacoes/1_consultarContratacoes_PNCP_14133', {
      params: {
        dataPublicacaoPncpInicial: dia,
        dataPublicacaoPncpFinal: diaSeguinte(dia),
        codigoModalidade: particao.params.modalidade,
        pagina,
        tamanhoPagina: TAMANHO_PAGINA,
      },
    });
    const brutos = corpo.resultado ?? [];
    const registros = brutos.map(normalizarContratacaoComprasGov).filter((r): r is OportunidadeColetada => r !== null);
    return { registros, pagina, totalPaginas: corpo.totalPaginas ?? 0, totalRegistros: corpo.totalRegistros ?? 0, invalidos: brutos.length - registros.length };
  }
}
