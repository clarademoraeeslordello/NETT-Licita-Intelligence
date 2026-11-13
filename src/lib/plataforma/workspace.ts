/**
 * Workspace da empresa: perfil, pipeline de licitações e cofre de documentos.
 *
 * Decisão de arquitetura: na versão de demonstração o workspace vive no
 * localStorage do navegador — qualquer pessoa abre o link e usa a plataforma
 * sem cadastro, e nenhum dado de empresa trafega para o servidor. O formato é
 * versionado e serializável para que a troca por um banco (Supabase/Postgres
 * com login) seja uma mudança de adaptador, não de modelo.
 */
import type { Oportunidade } from '../pncp/types';
import type { PerfilAderencia } from './aderencia';

export type Perfil = PerfilAderencia & {
  empresa: string;
  cnpj: string;
  porte: 'ME' | 'EPP' | 'Demais';
};

export type EtapaId = 'triagem' | 'analise' | 'documentacao' | 'proposta' | 'disputa' | 'resultado';

export const ETAPAS: Array<{ id: EtapaId; label: string; descricao: string; cor: string }> = [
  { id: 'triagem', label: 'Triagem', descricao: 'Vale a pena disputar?', cor: 'bg-ink-400' },
  { id: 'analise', label: 'Análise do edital', descricao: 'Leitura, riscos e exigências', cor: 'bg-brand-400' },
  { id: 'documentacao', label: 'Documentação', descricao: 'Habilitação e declarações', cor: 'bg-accent-500' },
  { id: 'proposta', label: 'Proposta', descricao: 'Preço e proposta comercial', cor: 'bg-warn-500' },
  { id: 'disputa', label: 'Em disputa', descricao: 'Sessão pública e lances', cor: 'bg-brand-600' },
  { id: 'resultado', label: 'Resultado', descricao: 'Ganhas e perdidas', cor: 'bg-ok-500' },
];

export const ETAPAS_ATIVAS: EtapaId[] = ['triagem', 'analise', 'documentacao', 'proposta', 'disputa'];

export type CardPipeline = {
  id: string;
  oportunidade: Oportunidade;
  etapa: EtapaId;
  criadoEm: string;
  atualizadoEm: string;
  notas: string;
  valorProposta: number | null;
  resultado: 'ganha' | 'perdida' | null;
  analiseId: string | null;
  exemplo?: boolean;
};

export type CategoriaDocumento = 'fiscal' | 'trabalhista' | 'juridica' | 'economica' | 'tecnica';

export const CATEGORIAS: Record<CategoriaDocumento, string> = {
  fiscal: 'Regularidade fiscal',
  trabalhista: 'Regularidade trabalhista',
  juridica: 'Habilitação jurídica',
  economica: 'Qualificação econômico-financeira',
  tecnica: 'Qualificação técnica',
};

export type Documento = {
  id: string;
  nome: string;
  categoria: CategoriaDocumento;
  emissor: string;
  emissao: string | null;
  /** YYYY-MM-DD. `null` = documento sem prazo de validade. */
  validade: string | null;
  /** Validade usual ao reemitir, para o botão "Renovar". */
  validadePadraoDias: number | null;
  linkEmissao: string | null;
  observacao: string;
};

export type Workspace = {
  versao: 1;
  perfil: Perfil;
  pipeline: CardPipeline[];
  documentos: Documento[];
  descartadas: string[];
  criadoEm: string;
  /** Escolha feita na primeira visita: explorar com exemplos ou começar do zero. */
  inicio?: 'exemplo' | 'zero';
};

export const STORAGE_KEY = 'arremate.workspace.v1';

const DIA_MS = 86_400_000;
const isoDia = (deslocamentoDias: number, base = Date.now()) =>
  new Date(base + deslocamentoDias * DIA_MS).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export const PERFIL_PADRAO: Perfil = {
  empresa: 'Norte Digital Tecnologia Ltda',
  cnpj: '',
  porte: 'EPP',
  termos: ['notebook', 'computador', 'monitor', 'impressora', 'equipamentos de informática'],
  termosExcluir: ['locação', 'manutenção predial'],
  ufs: ['SP', 'MG', 'PR', 'RJ'],
  modalidades: [6, 8],
  valorMin: 20_000,
  valorMax: 2_000_000,
};

/** Cofre inicial com situações variadas — válidos, a vencer e um vencido — para a demonstração. */
export function documentosIniciais(agora = Date.now()): Documento[] {
  const doc = (d: Omit<Documento, 'id'>, id: string): Documento => ({ ...d, id });
  return [
    doc({ nome: 'CND de Tributos Federais e Dívida Ativa da União', categoria: 'fiscal', emissor: 'Receita Federal / PGFN', emissao: isoDia(-62, agora), validade: isoDia(118, agora), validadePadraoDias: 180, linkEmissao: 'https://servicos.receitafederal.gov.br/servico/certidoes/', observacao: '' }, 'cnd-federal'),
    doc({ nome: 'Certificado de Regularidade do FGTS (CRF)', categoria: 'fiscal', emissor: 'Caixa Econômica Federal', emissao: isoDia(-22, agora), validade: isoDia(8, agora), validadePadraoDias: 30, linkEmissao: 'https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf', observacao: '' }, 'crf-fgts'),
    doc({ nome: 'Certidão Negativa de Débitos Trabalhistas (CNDT)', categoria: 'trabalhista', emissor: 'Tribunal Superior do Trabalho', emissao: isoDia(-30, agora), validade: isoDia(150, agora), validadePadraoDias: 180, linkEmissao: 'https://cndt-certidao.tst.jus.br/inicio.faces', observacao: '' }, 'cndt'),
    doc({ nome: 'Certidão de Regularidade Fiscal Estadual', categoria: 'fiscal', emissor: 'Secretaria da Fazenda do Estado', emissao: isoDia(-95, agora), validade: isoDia(-5, agora), validadePadraoDias: 90, linkEmissao: null, observacao: 'Prazo varia por estado.' }, 'cnd-estadual'),
    doc({ nome: 'Certidão de Regularidade Fiscal Municipal', categoria: 'fiscal', emissor: 'Prefeitura (sede da empresa)', emissao: isoDia(-30, agora), validade: isoDia(60, agora), validadePadraoDias: 90, linkEmissao: null, observacao: '' }, 'cnd-municipal'),
    doc({ nome: 'Certidão Negativa de Falência e Recuperação Judicial', categoria: 'economica', emissor: 'Tribunal de Justiça do Estado', emissao: isoDia(-75, agora), validade: isoDia(15, agora), validadePadraoDias: 90, linkEmissao: null, observacao: 'Alguns editais exigem emissão nos últimos 30 dias.' }, 'falencia'),
    doc({ nome: 'Balanço Patrimonial do último exercício', categoria: 'economica', emissor: 'Contabilidade / SPED', emissao: isoDia(-140, agora), validade: `${new Date(agora).getFullYear() + 1}-04-30`, validadePadraoDias: null, linkEmissao: null, observacao: 'Exigível até o fim de abril do ano seguinte ao exercício.' }, 'balanco'),
    doc({ nome: 'Contrato Social e última alteração consolidada', categoria: 'juridica', emissor: 'Junta Comercial', emissao: isoDia(-400, agora), validade: null, validadePadraoDias: null, linkEmissao: null, observacao: '' }, 'contrato-social'),
    doc({ nome: 'Atestado de Capacidade Técnica — fornecimento de equipamentos de TI', categoria: 'tecnica', emissor: 'Cliente público anterior', emissao: isoDia(-210, agora), validade: null, validadePadraoDias: null, linkEmissao: null, observacao: '' }, 'atestado-ti'),
  ];
}

export function workspaceInicial(pipelineExemplo: CardPipeline[] = [], agora = Date.now()): Workspace {
  return {
    versao: 1,
    perfil: PERFIL_PADRAO,
    pipeline: pipelineExemplo,
    documentos: documentosIniciais(agora),
    descartadas: [],
    criadoEm: new Date(agora).toISOString(),
  };
}

/** Valida o que veio do localStorage; qualquer coisa estranha volta ao padrão. */
export function lerWorkspace(bruto: string | null): Workspace | null {
  if (!bruto) return null;
  try {
    const dados = JSON.parse(bruto) as Partial<Workspace>;
    if (dados?.versao !== 1 || !dados.perfil || !Array.isArray(dados.pipeline) || !Array.isArray(dados.documentos)) return null;
    return {
      versao: 1,
      perfil: { ...PERFIL_PADRAO, ...dados.perfil },
      pipeline: dados.pipeline,
      documentos: dados.documentos,
      descartadas: Array.isArray(dados.descartadas) ? dados.descartadas : [],
      criadoEm: dados.criadoEm ?? new Date().toISOString(),
      inicio: dados.inicio === 'zero' || dados.inicio === 'exemplo' ? dados.inicio : undefined,
    };
  } catch {
    return null;
  }
}

/* ------------------------- Situação dos documentos ------------------------- */

export type SituacaoDocumento = 'valido' | 'a-vencer' | 'vencido' | 'permanente';

export const JANELA_ALERTA_DIAS = 15;

export function situacaoDocumento(doc: Documento, agora = Date.now()): { situacao: SituacaoDocumento; dias: number | null } {
  if (!doc.validade) return { situacao: 'permanente', dias: null };
  // Válido até o fim do dia da validade, no horário de Brasília.
  const fim = new Date(`${doc.validade}T23:59:59-03:00`).getTime();
  const dias = Math.floor((fim - agora) / DIA_MS);
  if (fim < agora) return { situacao: 'vencido', dias };
  if (dias <= JANELA_ALERTA_DIAS) return { situacao: 'a-vencer', dias };
  return { situacao: 'valido', dias };
}

/** Percentual do cofre apto para habilitação hoje (sem vencidos). */
export function prontidaoDocumental(documentos: Documento[], agora = Date.now()): number {
  if (documentos.length === 0) return 0;
  const aptos = documentos.filter((doc) => situacaoDocumento(doc, agora).situacao !== 'vencido').length;
  return Math.round((aptos / documentos.length) * 100);
}

export function renovarDocumento(doc: Documento, agora = Date.now()): Documento {
  return {
    ...doc,
    emissao: isoDia(0, agora),
    validade: doc.validadePadraoDias ? isoDia(doc.validadePadraoDias, agora) : doc.validade,
  };
}

/* ------------------------------ Pipeline ---------------------------------- */

export function novoCard(oportunidade: Oportunidade, etapa: EtapaId = 'triagem', agora = Date.now()): CardPipeline {
  const quando = new Date(agora).toISOString();
  return {
    id: oportunidade.id,
    oportunidade,
    etapa,
    criadoEm: quando,
    atualizadoEm: quando,
    notas: '',
    valorProposta: null,
    resultado: null,
    analiseId: null,
  };
}

export function valorEmDisputa(pipeline: CardPipeline[]): number {
  return pipeline
    .filter((card) => ETAPAS_ATIVAS.includes(card.etapa))
    .reduce((total, card) => total + (card.valorProposta ?? card.oportunidade.valorEstimado ?? 0), 0);
}

export function uid(prefixo: string): string {
  return `${prefixo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
