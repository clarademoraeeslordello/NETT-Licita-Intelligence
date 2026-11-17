/**
 * Normalização PURA de registros do PNCP para o contrato canônico (sem rede, sem banco, sem relógio).
 * Payload aceito: `{ compra, itens?, arquivos? }` — `compra` vem da consulta
 * (/consulta/v1/contratacoes/atualizacao ou /consulta/v1/orgaos/{cnpj}/compras/{ano}/{seq});
 * `itens`/`arquivos` da API PNCP (/pncp/v1/.../itens|arquivos). `null` = não consultado.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { uf as ufSchema } from '@/contracts/common';
import { MODALIDADES } from '@/lib/pncp/modalidades';
import { linkPncp, toIsoBrasilia } from '@/lib/pncp/api';
import { documentRef, opportunityItemUpsert, opportunityUpsert, type DocumentRef, type NormalizeResult, type OpportunityItemUpsert } from '../connector';

const texto = z.string().nullish();
const numero = z.number().nullish();

const compraSchema = z.looseObject({
  numeroControlePNCP: z.string(),
  anoCompra: z.number().int().optional(),
  sequencialCompra: z.number().int().optional(),
  numeroCompra: texto,
  processo: texto,
  objetoCompra: texto,
  informacaoComplementar: texto,
  orgaoEntidade: z.looseObject({ cnpj: texto, razaoSocial: texto, esferaId: texto }).nullish(),
  unidadeOrgao: z.looseObject({ nomeUnidade: texto, municipioNome: texto, ufSigla: texto }).nullish(),
  modalidadeId: numero,
  modalidadeNome: texto,
  modoDisputaNome: texto,
  tipoInstrumentoConvocatorioNome: texto,
  amparoLegal: z.looseObject({ nome: texto, descricao: texto }).nullish(),
  situacaoCompraId: numero,
  situacaoCompraNome: texto,
  srp: z.boolean().nullish(),
  existeResultado: z.boolean().nullish(),
  orcamentoSigilosoCodigo: numero,
  dataPublicacaoPncp: texto,
  dataAberturaProposta: texto,
  dataEncerramentoProposta: texto,
  valorTotalEstimado: numero,
  valorTotalHomologado: numero,
});

const itemSchema = z.looseObject({
  numeroItem: z.number().int(),
  descricao: texto,
  materialOuServico: texto,
  quantidade: numero,
  unidadeMedida: texto,
  valorUnitarioEstimado: numero,
  valorTotal: numero,
  orcamentoSigiloso: z.boolean().nullish(),
  criterioJulgamentoNome: texto,
  tipoBeneficio: numero,
  catalogoCodigoItem: z.union([z.string(), z.number()]).nullish(),
  ncmNbsCodigo: texto,
  temResultado: z.boolean().nullish(),
});

/** /pncp/v1/.../itens/{n}/resultados (T-214): fornecedor e preço unitário homologado de um item. */
const resultadoSchema = z.looseObject({
  niFornecedor: texto,
  tipoPessoa: texto,
  nomeRazaoSocialFornecedor: texto,
  valorUnitarioHomologado: numero,
  quantidadeHomologada: numero,
  dataResultado: texto,
  dataCancelamento: texto,
});

const arquivoSchema = z.looseObject({
  url: texto,
  uri: texto,
  titulo: texto,
  tipoDocumentoId: numero,
  tipoDocumentoNome: texto,
  sequencialDocumento: numero,
  dataPublicacaoPncp: texto,
  statusAtivo: z.boolean().nullish(),
});

export const pncpPayload = z.object({
  compra: compraSchema,
  itens: z.array(itemSchema).nullish(),
  arquivos: z.array(arquivoSchema).nullish(),
  /** T-214: resultados por número do item (chave = `numeroItem` como texto). Ausente = não consultado. */
  resultados: z.record(z.string(), z.array(resultadoSchema)).nullish(),
});
export type PncpPayload = z.infer<typeof pncpPayload>;

const limpar = (v: string | null | undefined): string | null => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t || null;
};

/** number → decimal string (até 4 casas), sem notação científica nem erro de ponto flutuante visível. */
export function toDecimal(v: number | null | undefined): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v.toFixed(4).replace(/\.?0+$/, '') || '0';
}

const ESFERAS = { F: 'federal', E: 'estadual', M: 'municipal', D: 'distrital' } as const;

/** Situação da compra no PNCP: 1 divulgada, 2 revogada, 3 anulada, 4 suspensa. */
function status(c: z.infer<typeof compraSchema>) {
  if (c.situacaoCompraId === 2 || c.situacaoCompraId === 3) return 'cancelled' as const;
  if (c.situacaoCompraId === 4) return 'suspended' as const;
  if (c.existeResultado || (c.valorTotalHomologado ?? 0) > 0) return 'awarded' as const;
  // Recebendo propostas/encerrada depende do relógio: calculado na leitura a partir de proposalsCloseAt
  // (normalização pura não usa `now`, senão o contentHash mudaria sem mudança na fonte).
  if (c.situacaoCompraId === 1) return 'published' as const;
  return 'unknown' as const;
}

/**
 * Vencedor do item (T-214). O contrato guarda UM fornecedor por item: entre os resultados não cancelados com preço
 * positivo vale o de maior quantidade homologada (empate: menor preço). CNPJ só com 14 dígitos: CPF de pessoa
 * física nunca é gravado (minimização de dados pessoais); o nome do fornecedor é dado público do PNCP.
 */
export function vencedorDoItem(resultados: z.infer<typeof resultadoSchema>[] | undefined) {
  const validos = (resultados ?? []).filter((r) => !r.dataCancelamento && (r.valorUnitarioHomologado ?? 0) > 0);
  if (!validos.length) return null;
  const melhor = [...validos].sort((a, b) => (b.quantidadeHomologada ?? 0) - (a.quantidadeHomologada ?? 0) || (a.valorUnitarioHomologado ?? 0) - (b.valorUnitarioHomologado ?? 0))[0]!;
  return {
    awardedUnitValue: toDecimal(melhor.valorUnitarioHomologado),
    awardedSupplierCnpj: /^\d{14}$/.test(melhor.niFornecedor ?? '') ? melhor.niFornecedor! : null,
    awardedSupplierName: limpar(melhor.nomeRazaoSocialFornecedor),
    awardedAt: toIsoBrasilia(melhor.dataResultado),
  };
}

/** tipoBeneficio do item: 1 exclusiva ME/EPP, 2 subcontratação, 3 cota reservada, 4 sem benefício, 5 não se aplica. */
function beneficioItem(codigo: number | null | undefined) {
  if (codigo === 1) return 'total' as const;
  if (codigo === 2 || codigo === 3) return 'partial' as const;
  if (codigo === 4 || codigo === 5) return 'none' as const;
  return 'unknown' as const;
}

function beneficioCompra(itens: OpportunityItemUpsert[] | null) {
  if (!itens?.length) return 'unknown' as const;
  const tipos = new Set(itens.map((i) => i.meEppBenefit));
  if (tipos.size === 1) return [...tipos][0]!;
  if (tipos.has('total') || tipos.has('partial')) return 'partial' as const;
  return tipos.has('unknown') ? ('unknown' as const) : ('none' as const);
}

function tipoDocumento(a: z.infer<typeof arquivoSchema>): DocumentRef['kind'] {
  // Títulos do PNCP vêm com "_" e sem acentos ("TR_E_ANEXOS", "AVISO_DE_LICITAO").
  const nome = ` ${a.tipoDocumentoNome ?? ''} ${a.titulo ?? ''} `
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  if (a.tipoDocumentoId === 4 || / termo de refer| tr /.test(nome)) return 'reference_term';
  if (a.tipoDocumentoId === 2 || a.tipoDocumentoId === 1 || / edital| aviso de (licita|contrata|dispensa)/.test(nome)) return 'tender_notice';
  if (/ mapa de pre/.test(nome)) return 'price_map';
  if (/ ata /.test(nome)) return 'minutes';
  return 'annex';
}

function mimePorTitulo(titulo: string): string {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(titulo)?.[1]?.toLowerCase();
  const mapa: Record<string, string> = {
    pdf: 'application/pdf',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    odt: 'application/vnd.oasis.opendocument.text',
  };
  return (ext && mapa[ext]) || 'application/octet-stream';
}

/** Somente URLs HTTPS do próprio PNCP são aceitas como origem de documento (anti-SSRF em T-203). */
export const urlDocumentoPermitida = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'pncp.gov.br' || u.hostname.endsWith('.pncp.gov.br'));
  } catch {
    return false;
  }
};

/** Hash estável do conteúdo normalizado (chaves ordenadas). */
export function contentHashOf(value: unknown): string {
  const ordenar = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordenar)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, ordenar(x)]))
        : v;
  return createHash('sha256').update(JSON.stringify(ordenar(value))).digest('hex');
}

/** `{cnpj}-1-{seq6}/{ano}` → partes. */
export function partesControle(controle: string): { cnpj: string; ano: string; sequencial: string } | null {
  const m = /^(\d{14})-\d+-(\d{1,7})\/(\d{4})$/.exec(controle.trim());
  return m ? { cnpj: m[1]!, sequencial: String(Number(m[2])), ano: m[3]! } : null;
}

export function normalizePncp(payload: unknown): NormalizeResult {
  const parsed = pncpPayload.safeParse(payload);
  if (!parsed.success) return { skip: `payload PNCP inválido: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` };
  const { compra: c, itens, arquivos, resultados } = parsed.data;

  const p = partesControle(c.numeroControlePNCP);
  const cnpj = c.orgaoEntidade?.cnpj ?? p?.cnpj;
  const ano = c.anoCompra ?? (p ? Number(p.ano) : undefined);
  const seq = c.sequencialCompra ?? (p ? Number(p.sequencial) : undefined);
  if (!cnpj || !/^\d{14}$/.test(cnpj) || !ano || !seq) return { skip: `identificação incompleta: ${c.numeroControlePNCP}` };
  const objeto = limpar(c.objetoCompra);
  if (!objeto) return { skip: `sem objeto: ${c.numeroControlePNCP}` };

  const items: OpportunityItemUpsert[] | null = itens
    ? itens.map((i) => {
        const sigiloso = Boolean(i.orcamentoSigiloso);
        return opportunityItemUpsert.parse({
          number: i.numeroItem,
          description: limpar(i.descricao) ?? `Item ${i.numeroItem}`,
          kind: i.materialOuServico === 'S' ? 'service' : 'material',
          quantity: toDecimal(i.quantidade) ?? '0',
          unit: limpar(i.unidadeMedida) ?? 'UN',
          estimatedUnitValue: sigiloso ? null : toDecimal(i.valorUnitarioEstimado),
          estimatedTotalValue: sigiloso ? null : toDecimal(i.valorTotal),
          judgingCriterion: limpar(i.criterioJulgamentoNome),
          meEppBenefit: beneficioItem(i.tipoBeneficio),
          catalogCode: limpar(i.catalogoCodigoItem == null ? null : String(i.catalogoCodigoItem)) ?? limpar(i.ncmNbsCodigo),
          ...(vencedorDoItem(resultados?.[String(i.numeroItem)]) ?? { awardedUnitValue: null, awardedSupplierCnpj: null, awardedSupplierName: null, awardedAt: null }),
        });
      })
    : null;

  const documents: DocumentRef[] = (arquivos ?? [])
    .filter((a) => a.statusAtivo !== false)
    .flatMap((a) => {
      const url = a.url ?? a.uri;
      if (!url || !urlDocumentoPermitida(url)) return [];
      const titulo = limpar(a.titulo) ?? 'Documento';
      return [
        documentRef.parse({
          externalId: String(a.sequencialDocumento ?? url),
          kind: tipoDocumento(a),
          title: titulo,
          sourceUrl: url,
          mimeType: mimePorTitulo(titulo),
          publishedAt: toIsoBrasilia(a.dataPublicacaoPncp),
        }),
      ];
    });

  const sigiloso = typeof c.orcamentoSigilosoCodigo === 'number' && c.orcamentoSigilosoCodigo !== 1;
  const estimado = !sigiloso && (c.valorTotalEstimado ?? 0) > 0 ? toDecimal(c.valorTotalEstimado) : null;
  const ufParsed = ufSchema.safeParse(c.unidadeOrgao?.ufSigla);
  const modalidade = typeof c.modalidadeId === 'number' ? c.modalidadeId : null;
  const amparo = c.amparoLegal ? limpar([c.amparoLegal.nome, c.amparoLegal.descricao].filter(Boolean).join(' — ')) : null;

  const base = {
    canonicalKey: `pncp:${cnpj}-${ano}-${seq}`,
    title: [limpar(c.tipoInstrumentoConvocatorioNome) ?? 'Edital', c.numeroCompra ? `nº ${limpar(c.numeroCompra)}/${ano}` : null].filter(Boolean).join(' '),
    objectDescription: [objeto, limpar(c.informacaoComplementar)].filter(Boolean).join('\n\n'),
    agencyName: limpar(c.orgaoEntidade?.razaoSocial) ?? 'Órgão não informado',
    agencyCnpj: cnpj,
    agencyUnit: limpar(c.unidadeOrgao?.nomeUnidade),
    municipality: limpar(c.unidadeOrgao?.municipioNome),
    uf: ufParsed.success ? ufParsed.data : null,
    sphere: ESFERAS[(c.orgaoEntidade?.esferaId ?? '') as keyof typeof ESFERAS] ?? 'desconhecida',
    modalityCode: modalidade,
    modalityName: (modalidade !== null ? MODALIDADES[modalidade] : undefined) ?? limpar(c.modalidadeNome),
    disputeMode: limpar(c.modoDisputaNome),
    legalBasis: amparo,
    processNumber: limpar(c.processo),
    status: status(c),
    publishedAt: toIsoBrasilia(c.dataPublicacaoPncp),
    proposalsOpenAt: toIsoBrasilia(c.dataAberturaProposta),
    proposalsCloseAt: toIsoBrasilia(c.dataEncerramentoProposta),
    sessionAt: null,
    estimatedValue: estimado,
    awardedValue: (c.valorTotalHomologado ?? 0) > 0 ? toDecimal(c.valorTotalHomologado) : null,
    confidentialBudget: sigiloso,
    priceRegistration: Boolean(c.srp),
    meEppBenefit: beneficioCompra(items),
    url: linkPncp(cnpj, ano, seq),
  };
  const opportunity = opportunityUpsert.parse({ ...base, contentHash: contentHashOf({ base, items, documents }) });
  return { opportunity, items: items ?? [], documents };
}
