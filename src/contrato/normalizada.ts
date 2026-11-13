/** Forma interna produzida por todo conector antes da persistência. */
import type { FonteId } from './oportunidade.js';

export type Esfera = 'federal' | 'estadual' | 'municipal' | 'distrital';

export type OportunidadeColetada = {
  fonte: FonteId;
  idExterno: string;
  urlOrigem: string | null;
  numeroControlePncp: string | null;
  numeroCompra: string | null;
  ano: number | null;
  sequencial: number | null;
  processo: string | null;
  objeto: string;
  informacaoComplementar: string | null;
  orgaoCnpj: string | null;
  orgaoNome: string;
  unidadeNome: string | null;
  municipio: string | null;
  uf: string | null;
  esfera: Esfera | null;
  modalidadeIdPncp: number | null;
  modalidadeNome: string;
  situacao: string | null;
  srp: boolean | null;
  amparoLegal: string | null;
  dataPublicacao: string | null;
  dataAberturaPropostas: string | null;
  dataEncerramentoPropostas: string | null;
  dataAtualizacaoFonte: string | null;
  valorEstimado: number | null;
  valorHomologado: number | null;
  linkOficial: string;
  linkSistemaOrigem: string | null;
  cancelada: boolean;
  /** Resposta bruta da fonte, preservada para auditoria e reprocessamento. */
  bruto: unknown;
};

export type DocumentoColetado = {
  fonte: FonteId;
  idExterno: string;
  titulo: string;
  tipo: string;
  url: string;
  publicadoEm: string | null;
};

export type ItemColetado = {
  numero: number;
  descricao: string;
  tipo: 'material' | 'servico';
  quantidade: number | null;
  unidade: string | null;
  valorUnitarioEstimado: number | null;
  valorTotalEstimado: number | null;
};
