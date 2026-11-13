/**
 * Schema canônico da análise de edital.
 *
 * Regras de ouro embutidas no modelo de dados:
 *  1. Nada é inventado: toda `Evidence` só existe com `status: 'found'` se um
 *     trecho literal foi localizado no documento.
 *  2. Inferência é sempre explícita (`status: 'inferred'`), nunca apresentada
 *     como fato.
 *  3. Ausência é representada (`status: 'not_found'`) e vira a string
 *     "Não identificado no documento." na apresentação.
 *  4. Rastreabilidade: quando possível guardamos a página/seção de origem.
 *
 * O mesmo schema é usado para (a) validar a resposta do LLM, (b) tipar a
 * interface e (c) alimentar a geração do relatório.
 */
import { z } from 'zod';
import { NOT_FOUND_LABEL } from './evidence';

export { NOT_FOUND_LABEL, evidenceText, isNotFound, countFound } from './evidence';
export type { EvidenceLike } from './evidence';

/** Classificação obrigatória de cada informação extraída. */
export const evidenceStatusSchema = z.enum(['found', 'inferred', 'not_found']);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

/**
 * Bloco de informação rastreável.
 * `value` é a informação em si (texto, data, valor monetário...).
 */
export const evidenceSchema = z.object({
  status: evidenceStatusSchema,
  value: z.union([z.string(), z.number(), z.null()]).optional(),
  /** Trecho literal do edital que sustenta a informação. */
  quote: z.union([z.string(), z.null()]).optional(),
  /** Página (1-based) ou seção do edital de onde a informação veio. */
  source: z.union([z.string(), z.null()]).optional(),
  /** Justificativa curta, obrigatória quando `status` é `inferred`. */
  reason: z.union([z.string(), z.null()]).optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/** Item de lista com origem opcional. */
export const sourcedItemSchema = z.object({
  text: z.string(),
  source: z.union([z.string(), z.null()]).optional(),
  status: evidenceStatusSchema.optional(),
});
export type SourcedItem = z.infer<typeof sourcedItemSchema>;

export const partySchema = z.object({
  nome: z.string(),
  documento: z.union([z.string(), z.null()]).optional(),
  papel: z.string(),
  contato: z.union([z.string(), z.null()]).optional(),
});
export type Party = z.infer<typeof partySchema>;

export const itemSchema = z.object({
  numero: z.union([z.string(), z.null()]).optional(),
  descricao: z.string(),
  quantidade: z.union([z.string(), z.null()]).optional(),
  unidade: z.union([z.string(), z.null()]).optional(),
  valorUnitario: z.union([z.string(), z.null()]).optional(),
  valorTotal: z.union([z.string(), z.null()]).optional(),
  lote: z.union([z.string(), z.null()]).optional(),
  especificacoes: z.union([z.string(), z.null()]).optional(),
  source: z.union([z.string(), z.null()]).optional(),
});
export type TenderItem = z.infer<typeof itemSchema>;

export const timelineEntrySchema = z.object({
  evento: z.string(),
  data: z.string(),
  hora: z.union([z.string(), z.null()]).optional(),
  /** `found` quando a data está no edital; `inferred` quando deduzida. */
  status: evidenceStatusSchema.optional(),
  observacao: z.union([z.string(), z.null()]).optional(),
  source: z.union([z.string(), z.null()]).optional(),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const attentionPointSchema = z.object({
  titulo: z.string(),
  /** Explicação objetiva do risco/atenção. */
  motivo: z.string(),
  nivel: z.enum(['alto', 'medio', 'baixo']),
  recomendacao: z.union([z.string(), z.null()]).optional(),
  trecho: z.union([z.string(), z.null()]).optional(),
  source: z.union([z.string(), z.null()]).optional(),
});
export type AttentionPoint = z.infer<typeof attentionPointSchema>;

export const checklistEntrySchema = z.object({
  item: z.string(),
  obrigatorio: z.boolean().optional(),
  observacao: z.union([z.string(), z.null()]).optional(),
  source: z.union([z.string(), z.null()]).optional(),
});
export type ChecklistEntry = z.infer<typeof checklistEntrySchema>;

export const generalInfoSchema = z.object({
  orgao: evidenceSchema,
  numeroEdital: evidenceSchema,
  modalidade: evidenceSchema,
  processo: evidenceSchema,
  objeto: evidenceSchema,
  portal: evidenceSchema,
  localDisputa: evidenceSchema,
  regimeExecucao: evidenceSchema,
  criterioJulgamento: evidenceSchema,
  vigenciaContrato: evidenceSchema,
});

export const valoresSchema = z.object({
  valorEstimado: evidenceSchema,
  valorMaximo: evidenceSchema,
  moeda: z.union([z.string(), z.null()]).optional(),
  itens: z.array(itemSchema).optional(),
  observacoes: z.array(sourcedItemSchema).optional(),
});

export const objetoDetalhadoSchema = z.object({
  resumo: z.string(),
  descricaoDetalhada: z.string(),
  itens: z.array(itemSchema).optional(),
  lotes: z.array(sourcedItemSchema).optional(),
  especificacoesTecnicas: z.array(sourcedItemSchema).optional(),
});

export const participacaoSchema = z.object({
  quemPodeParticipar: z.array(sourcedItemSchema).optional(),
  habilitacaoJuridica: z.array(sourcedItemSchema).optional(),
  habilitacaoFiscalTrabalhista: z.array(sourcedItemSchema).optional(),
  qualificacaoTecnica: z.array(sourcedItemSchema).optional(),
  qualificacaoEconomicoFinanceira: z.array(sourcedItemSchema).optional(),
  certidoes: z.array(sourcedItemSchema).optional(),
  documentos: z.array(sourcedItemSchema).optional(),
  restricoes: z.array(sourcedItemSchema).optional(),
  exigenciasEspecificas: z.array(sourcedItemSchema).optional(),
  visitasOuAmostras: z.array(sourcedItemSchema).optional(),
  consorcio: evidenceSchema,
  meEpp: evidenceSchema,
});

export const obrigacoesSchema = z.object({
  contratada: z.array(sourcedItemSchema).optional(),
  contratante: z.array(sourcedItemSchema).optional(),
  prazoExecucao: evidenceSchema,
  prazoEntrega: evidenceSchema,
  condicoesPagamento: z.array(sourcedItemSchema).optional(),
  garantias: z.array(sourcedItemSchema).optional(),
  penalidades: z.array(sourcedItemSchema).optional(),
  sancoes: z.array(sourcedItemSchema).optional(),
  subcontratacao: evidenceSchema,
});

export const analiseSchema = z.object({
  schemaVersion: z.literal('1.0').optional(),
  documento: z.object({
    titulo: z.string(),
    orgao: z.union([z.string(), z.null()]).optional(),
    numeroEdital: z.union([z.string(), z.null()]).optional(),
    modalidade: z.union([z.string(), z.null()]).optional(),
    paginas: z.number().optional(),
    caracteres: z.number().optional(),
    dataAnalise: z.string(),
  }),
  resumoExecutivo: z.object({
    visaoGeral: z.string(),
    destaques: z.array(sourcedItemSchema),
    alertaPrazo: z.union([z.string(), z.null()]).optional(),
    recomendacao: z.string(),
  }),
  informacoesGerais: generalInfoSchema,
  cronograma: z.array(timelineEntrySchema),
  outrosPrazos: z.array(timelineEntrySchema).optional(),
  objeto: objetoDetalhadoSchema,
  participacao: participacaoSchema,
  obrigacoes: obrigacoesSchema,
  valores: valoresSchema,
  pontosDeAtencao: z.array(attentionPointSchema),
  checklist: z.array(checklistEntrySchema),
  conclusao: z.object({
    texto: z.string(),
    proximosPassos: z.array(sourcedItemSchema),
    limitacoesDaAnalise: z.array(z.string()),
  }),
  /** Confiança global declarada pelo modelo (ou calculada no modo local). */
  confianca: z
    .object({
      nivel: z.enum(['alta', 'media', 'baixa']),
      justificativa: z.string(),
    })
    .optional(),
});

export type AnaliseEditais = z.infer<typeof analiseSchema>;
export type GeneralInfo = z.infer<typeof generalInfoSchema>;
export type Valores = z.infer<typeof valoresSchema>;
export type Participacao = z.infer<typeof participacaoSchema>;
export type Obrigacoes = z.infer<typeof obrigacoesSchema>;

/** Metadados do pipeline anexados à análise (não vêm do LLM). */
export type AnalysisMeta = {
  engine: 'deepseek' | 'local-demo';
  model?: string;
  chunks?: number;
  llmCalls?: number;
  tokensEstimados?: number;
  duracaoMs?: number;
  avisos: string[];
  custoEstimadoUSD?: number;
  /** Motivo técnico quando a IA falhou e o motor local assumiu (diagnóstico). */
  falhaIa?: string;
};

export type AnalysisResult = {
  analise: AnaliseEditais;
  meta: AnalysisMeta;
};
