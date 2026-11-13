/**
 * Tipos normalizados da integração com o PNCP (Portal Nacional de Contratações
 * Públicas). A API pública mistura snake_case (busca) e camelCase (consulta);
 * tudo que sai de `src/lib/pncp` já vem neste formato único.
 */

export type Oportunidade = {
  /** `${cnpj}-${ano}-${sequencial}` — estável e usado como chave em todo o app. */
  id: string;
  cnpj: string;
  ano: string;
  sequencial: string;
  numeroControle: string;
  titulo: string;
  objeto: string;
  orgao: string;
  unidade: string;
  municipio: string;
  uf: string;
  esfera: string;
  modalidadeId: number;
  modalidade: string;
  situacao: string;
  publicadaEm: string | null;
  aberturaPropostas: string | null;
  encerramentoPropostas: string | null;
  /** Só vem no detalhe da compra; a busca não informa. `null` = não consultado ou sigiloso. */
  valorEstimado: number | null;
  temResultado: boolean;
  cancelado: boolean;
  linkPncp: string;
};

export type CompraDetalhe = {
  valorEstimado: number | null;
  valorHomologado: number | null;
  processo: string | null;
  numeroCompra: string | null;
  amparoLegal: string | null;
  modoDisputa: string | null;
  srp: boolean;
  informacaoComplementar: string | null;
  linkSistemaOrigem: string | null;
  aberturaPropostas: string | null;
  encerramentoPropostas: string | null;
  situacao: string | null;
  orcamentoSigiloso: boolean;
};

export type ItemCompra = {
  numero: number;
  descricao: string;
  tipo: 'Material' | 'Serviço';
  quantidade: number;
  unidade: string;
  valorUnitarioEstimado: number | null;
  valorTotalEstimado: number | null;
  criterioJulgamento: string | null;
  beneficio: string | null;
  situacao: string | null;
  temResultado: boolean;
};

export type ArquivoCompra = {
  sequencial: number;
  titulo: string;
  tipo: string;
  url: string;
  publicadoEm: string | null;
  ativo: boolean;
};

export type ResultadoItem = {
  fornecedor: string;
  documentoFornecedor: string;
  porte: string | null;
  valorUnitario: number;
  quantidade: number;
  percentualDesconto: number | null;
  dataResultado: string | null;
  meEpp: boolean;
};

/** Uma amostra de preço vencedor para a Inteligência de Preços. */
export type AmostraPreco = {
  id: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorEstimadoUnitario: number | null;
  valorHomologadoUnitario: number;
  /** Diferença entre estimado e homologado, em % (positivo = abaixo do estimado). */
  desconto: number | null;
  fornecedor: string;
  documentoFornecedor: string;
  porte: string | null;
  dataResultado: string | null;
  orgao: string;
  municipio: string;
  uf: string;
  modalidade: string;
  linkPncp: string;
};

export type FonteDados = 'pncp' | 'amostra';
