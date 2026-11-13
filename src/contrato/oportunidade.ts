/**
 * Contrato de saída: Oportunidade normalizada entregue ao Agente 03 (IA) e ao Agente 04 (UI).
 *
 * STATUS: PROPOSTA do Agente 02 (versão 0.1.0-proposta). O contrato oficial é publicado pelo
 * Agente 01 em docs/coordination/CONTRACTS.md; enquanto não houver aprovação, este schema é
 * o que a API interna efetivamente devolve e deve ser revisado antes de qualquer consumo em produção.
 */
import { z } from 'zod';

export const VERSAO_CONTRATO = '0.1.0-proposta';

export const FonteId = z.enum(['pncp', 'comprasgov', 'siga_rj', 'trello']);
export type FonteId = z.infer<typeof FonteId>;

const DataIso = z.string().datetime({ offset: true }).nullable();

export const Documento = z.object({
  id: z.string(),
  fonte: FonteId,
  idExterno: z.string(),
  titulo: z.string(),
  tipo: z.string(),
  url: z.string().url(),
  publicadoEm: DataIso,
  coletadoEm: z.string().datetime({ offset: true }),
});

export const Item = z.object({
  numero: z.number().int(),
  descricao: z.string(),
  tipo: z.enum(['material', 'servico']),
  quantidade: z.number().nullable(),
  unidade: z.string().nullable(),
  valorUnitarioEstimado: z.number().nullable(),
  valorTotalEstimado: z.number().nullable(),
});

export const OrigemFonte = z.object({
  fonte: FonteId,
  idExterno: z.string(),
  urlOrigem: z.string().nullable(),
  primeiraColetaEm: z.string().datetime({ offset: true }),
  ultimaColetaEm: z.string().datetime({ offset: true }),
});

export const EntradaHistorico = z.object({
  versao: z.number().int(),
  tipo: z.enum(['criacao', 'atualizacao']),
  fonte: FonteId,
  alteradoEm: z.string().datetime({ offset: true }),
  camposAlterados: z.record(z.object({ de: z.unknown(), para: z.unknown() })),
});

export const Oportunidade = z.object({
  versaoContrato: z.literal(VERSAO_CONTRATO),
  id: z.string().uuid(),
  /** Chave de deduplicação entre fontes. Ex.: `pncp:00394502000144-1-014968/2026`. */
  chaveCanonica: z.string(),
  identificacao: z.object({
    numeroControlePncp: z.string().nullable(),
    numeroCompra: z.string().nullable(),
    ano: z.number().int().nullable(),
    processo: z.string().nullable(),
  }),
  objeto: z.string(),
  informacaoComplementar: z.string().nullable(),
  orgao: z.object({
    cnpj: z.string().nullable(),
    nome: z.string(),
    unidade: z.string().nullable(),
    municipio: z.string().nullable(),
    uf: z.string().nullable(),
    esfera: z.enum(['federal', 'estadual', 'municipal', 'distrital']).nullable(),
  }),
  modalidade: z.object({ idPncp: z.number().int().nullable(), nome: z.string() }),
  situacao: z.string().nullable(),
  srp: z.boolean().nullable(),
  amparoLegal: z.string().nullable(),
  datas: z.object({
    publicacao: DataIso,
    aberturaPropostas: DataIso,
    encerramentoPropostas: DataIso,
    atualizacaoFonte: DataIso,
  }),
  valor: z.object({ estimado: z.number().nullable(), homologado: z.number().nullable(), moeda: z.literal('BRL') }),
  linkOficial: z.string().url(),
  linkSistemaOrigem: z.string().nullable(),
  /** Termos do dicionário comercial que motivaram a captura. Não é avaliação de aderência (Agente 03). */
  termosDicionario: z.array(z.string()),
  statusProcessamento: z.enum(['listada', 'processada', 'erro']),
  documentos: z.array(Documento),
  itens: z.array(Item),
  origens: z.array(OrigemFonte),
  primeiraColetaEm: z.string().datetime({ offset: true }),
  atualizadaEm: z.string().datetime({ offset: true }),
  versao: z.number().int(),
  historico: z.array(EntradaHistorico),
});
export type Oportunidade = z.infer<typeof Oportunidade>;

/** Eventos publicados na tabela de saída (outbox) e expostos em GET /v1/eventos. */
export const TipoEvento = z.enum([
  'oportunidade.criada',
  'oportunidade.atualizada',
  'oportunidade.pronta_para_avaliacao',
  'oportunidade.possivel_duplicata',
  'trello.card_atualizado',
]);
export type TipoEvento = z.infer<typeof TipoEvento>;
