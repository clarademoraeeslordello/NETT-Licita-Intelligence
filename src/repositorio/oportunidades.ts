/**
 * Persistência de oportunidades: upsert idempotente com deduplicação, histórico de versões,
 * rastreio de origem por fonte e eventos de saída (outbox).
 */
import type pg from 'pg';
import type { DocumentoColetado, ItemColetado, OportunidadeColetada } from '../contrato/normalizada.js';
import type { FonteId, TipoEvento } from '../contrato/oportunidade.js';
import { emTransacao, obterPool, type Executor } from '../db/pool.js';
import { LIMIAR_POSSIVEL_DUPLICATA, chaveCanonica, hashEstavel, normalizarProcesso, similaridadeObjeto } from '../dedupe/dedupe.js';

/** Campos versionados: coluna no banco ← campo normalizado. */
export const CAMPOS = {
  numero_controle_pncp: 'numeroControlePncp',
  numero_compra: 'numeroCompra',
  ano: 'ano',
  processo: 'processo',
  objeto: 'objeto',
  informacao_complementar: 'informacaoComplementar',
  orgao_cnpj: 'orgaoCnpj',
  orgao_nome: 'orgaoNome',
  unidade_nome: 'unidadeNome',
  municipio: 'municipio',
  uf: 'uf',
  esfera: 'esfera',
  modalidade_id_pncp: 'modalidadeIdPncp',
  modalidade_nome: 'modalidadeNome',
  situacao: 'situacao',
  srp: 'srp',
  amparo_legal: 'amparoLegal',
  data_publicacao: 'dataPublicacao',
  data_abertura_propostas: 'dataAberturaPropostas',
  data_encerramento_propostas: 'dataEncerramentoPropostas',
  data_atualizacao_fonte: 'dataAtualizacaoFonte',
  valor_estimado: 'valorEstimado',
  valor_homologado: 'valorHomologado',
  link_oficial: 'linkOficial',
  link_sistema_origem: 'linkSistemaOrigem',
  cancelada: 'cancelada',
} as const satisfies Record<string, keyof OportunidadeColetada>;

type Coluna = keyof typeof CAMPOS;
const COLUNAS = Object.keys(CAMPOS) as Coluna[];
const COLUNAS_DATA = new Set<Coluna>(['data_publicacao', 'data_abertura_propostas', 'data_encerramento_propostas', 'data_atualizacao_fonte']);

/** Prioridade de confiança entre fontes (menor = mais confiável). */
export const PRIORIDADE_FONTE: Record<FonteId, number> = { pncp: 1, comprasgov: 2, siga_rj: 3, trello: 9 };

const comparavel = (coluna: Coluna, valor: unknown): unknown => {
  if (valor === undefined || valor === null) return null;
  if (COLUNAS_DATA.has(coluna)) return new Date(valor as string | Date).toISOString();
  if (coluna === 'valor_estimado' || coluna === 'valor_homologado') return Number(Number(valor).toFixed(4));
  return valor;
};

export type ResultadoUpsert = { oportunidadeId: string; resultado: 'nova' | 'atualizada' | 'inalterada'; chave: string; versao: number };

export async function registrarEvento(db: Executor, tipo: TipoEvento, agregadoId: string, payload: Record<string, unknown>): Promise<void> {
  await db.query('INSERT INTO integracao.evento_saida (tipo, agregado_id, payload) VALUES ($1, $2, $3)', [tipo, agregadoId, payload]);
}

/**
 * Insere ou atualiza uma oportunidade coletada.
 * Fontes de menor prioridade só preenchem campos vazios de registros já alimentados por fonte mais confiável.
 */
export async function salvarOportunidade(r: OportunidadeColetada, termos: string[]): Promise<ResultadoUpsert> {
  const chave = chaveCanonica(r);
  const hashPayload = hashEstavel(r.bruto);

  return emTransacao(async (db) => {
    const existente = (
      await db.query<Record<string, unknown> & { id: string; versao: number; fonte_principal: FonteId; termos_dicionario: string[] }>(
        'SELECT * FROM integracao.oportunidade WHERE chave_canonica = $1 FOR UPDATE',
        [chave],
      )
    ).rows[0];

    if (!existente) {
      const valores = COLUNAS.map((c) => r[CAMPOS[c]] ?? null);
      const hash = hashEstavel(Object.fromEntries(COLUNAS.map((c, i) => [c, comparavel(c, valores[i])])));
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO integracao.oportunidade (chave_canonica, ${COLUNAS.join(', ')}, termos_dicionario, hash_conteudo, fonte_principal)
         VALUES ($1, ${COLUNAS.map((_, i) => `$${i + 2}`).join(', ')}, $${COLUNAS.length + 2}, $${COLUNAS.length + 3}, $${COLUNAS.length + 4})
         RETURNING id`,
        [chave, ...valores, termos, hash, r.fonte],
      );
      const id = rows[0]!.id;
      const criacao = Object.fromEntries(COLUNAS.filter((_, i) => valores[i] !== null).map((c, _i) => [c, { de: null, para: comparavel(c, r[CAMPOS[c]]) }]));
      await db.query(
        `INSERT INTO integracao.oportunidade_historico (oportunidade_id, versao, tipo, fonte_id, campos_alterados) VALUES ($1, 1, 'criacao', $2, $3)`,
        [id, r.fonte, criacao],
      );
      await registrarOrigem(db, id, r, hashPayload);
      await registrarEvento(db, 'oportunidade.criada', id, { chave, fonte: r.fonte, idExterno: r.idExterno, versao: 1 });
      await detectarPossiveisDuplicatas(db, id, r, chave);
      return { oportunidadeId: id, resultado: 'nova', chave, versao: 1 };
    }

    const id = existente.id;
    const maisConfiavel = PRIORIDADE_FONTE[r.fonte] <= PRIORIDADE_FONTE[existente.fonte_principal];
    const alterados: Record<string, { de: unknown; para: unknown }> = {};
    for (const c of COLUNAS) {
      const novo = comparavel(c, r[CAMPOS[c]]);
      const atual = comparavel(c, existente[c]);
      if (novo === null && !maisConfiavel) continue;
      if (!maisConfiavel && atual !== null) continue;
      // Fonte confiável que passou a omitir um valor não apaga o que já se sabe.
      if (novo === null) continue;
      if (JSON.stringify(novo) !== JSON.stringify(atual)) alterados[c] = { de: atual, para: novo };
    }
    const novosTermos = [...new Set([...existente.termos_dicionario, ...termos])].sort();
    const termosMudaram = novosTermos.length !== existente.termos_dicionario.length;

    await registrarOrigem(db, id, r, hashPayload);

    if (!Object.keys(alterados).length) {
      if (termosMudaram) await db.query('UPDATE integracao.oportunidade SET termos_dicionario = $2 WHERE id = $1', [id, novosTermos]);
      return { oportunidadeId: id, resultado: 'inalterada', chave, versao: existente.versao };
    }

    const versao = existente.versao + 1;
    const sets = Object.keys(alterados).map((c, i) => `${c} = $${i + 2}`);
    const linha = { ...existente, ...Object.fromEntries(Object.entries(alterados).map(([c, v]) => [c, v.para])) };
    const hash = hashEstavel(Object.fromEntries(COLUNAS.map((c) => [c, comparavel(c, linha[c])])));
    const n = sets.length + 2;
    await db.query(
      `UPDATE integracao.oportunidade SET ${sets.join(', ')}, versao = $${n}, hash_conteudo = $${n + 1}, termos_dicionario = $${n + 2},
              fonte_principal = $${n + 3}, atualizada_em = now(),
              -- mudança relevante exige novo processamento (documentos/itens e reavaliação pelo Agente 03)
              status_processamento = 'listada'
        WHERE id = $1`,
      [id, ...Object.values(alterados).map((v) => v.para), versao, hash, novosTermos, maisConfiavel ? r.fonte : existente.fonte_principal],
    );
    await db.query(
      `INSERT INTO integracao.oportunidade_historico (oportunidade_id, versao, tipo, fonte_id, campos_alterados) VALUES ($1, $2, 'atualizacao', $3, $4)`,
      [id, versao, r.fonte, alterados],
    );
    await registrarEvento(db, 'oportunidade.atualizada', id, { chave, fonte: r.fonte, versao, campos: Object.keys(alterados) });
    return { oportunidadeId: id, resultado: 'atualizada', chave, versao };
  });
}

async function registrarOrigem(db: pg.PoolClient, oportunidadeId: string, r: OportunidadeColetada, hashPayload: string) {
  await db.query(
    `INSERT INTO integracao.oportunidade_fonte (oportunidade_id, fonte_id, id_externo, url_origem, hash_payload, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (fonte_id, id_externo) DO UPDATE
       SET ultima_coleta_em = now(), vezes_vista = integracao.oportunidade_fonte.vezes_vista + 1,
           url_origem = EXCLUDED.url_origem, hash_payload = EXCLUDED.hash_payload, payload = EXCLUDED.payload,
           oportunidade_id = EXCLUDED.oportunidade_id`,
    [oportunidadeId, r.fonte, r.idExterno, r.urlOrigem, hashPayload, JSON.stringify(r.bruto)],
  );
}

/** Registra possíveis duplicatas (chaves diferentes, mesmo órgão, objeto parecido ou mesmo processo). */
async function detectarPossiveisDuplicatas(db: pg.PoolClient, id: string, r: OportunidadeColetada, chave: string): Promise<void> {
  if (!r.orgaoCnpj) return;
  const { rows } = await db.query<{ id: string; objeto: string; processo: string | null }>(
    `SELECT id, objeto, processo FROM integracao.oportunidade
      WHERE orgao_cnpj = $1 AND id <> $2 AND chave_canonica <> $3
        AND (ano IS NOT DISTINCT FROM $4 OR ano IS NULL OR $4::int IS NULL)
      ORDER BY primeira_coleta_em DESC LIMIT 200`,
    [r.orgaoCnpj, id, chave, r.ano],
  );
  for (const c of rows) {
    const mesmoProcesso = Boolean(r.processo && c.processo && normalizarProcesso(r.processo) === normalizarProcesso(c.processo));
    const sim = similaridadeObjeto(r.objeto, c.objeto);
    if (!mesmoProcesso && sim < LIMIAR_POSSIVEL_DUPLICATA) continue;
    const [a, b] = [id, c.id].sort();
    const motivo = mesmoProcesso ? 'mesmo_orgao_mesmo_processo' : 'mesmo_orgao_objeto_similar';
    const { rowCount } = await db.query(
      `INSERT INTO integracao.possivel_duplicata (oportunidade_a, oportunidade_b, motivo, similaridade)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [a, b, motivo, mesmoProcesso ? 1 : sim],
    );
    if (rowCount) await registrarEvento(db, 'oportunidade.possivel_duplicata', id, { outra: c.id, motivo, similaridade: sim });
  }
}

export async function salvarEnriquecimento(oportunidadeId: string, documentos: DocumentoColetado[], itens: ItemColetado[]): Promise<void> {
  await emTransacao(async (db) => {
    const vistos: string[] = [];
    for (const d of documentos) {
      vistos.push(`${d.fonte}:${d.idExterno}`);
      await db.query(
        `INSERT INTO integracao.documento (oportunidade_id, fonte_id, id_externo, titulo, tipo, url, publicado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (oportunidade_id, fonte_id, id_externo) DO UPDATE
           SET titulo = EXCLUDED.titulo, tipo = EXCLUDED.tipo, url = EXCLUDED.url, publicado_em = EXCLUDED.publicado_em,
               ativo = true, coletado_em = now()`,
        [oportunidadeId, d.fonte, d.idExterno, d.titulo, d.tipo, d.url, d.publicadoEm],
      );
    }
    // Documentos removidos na fonte ficam inativos (não apagados) para preservar histórico.
    await db.query(
      `UPDATE integracao.documento SET ativo = false WHERE oportunidade_id = $1 AND NOT ((fonte_id || ':' || id_externo) = ANY($2))`,
      [oportunidadeId, vistos],
    );
    for (const i of itens) {
      await db.query(
        `INSERT INTO integracao.oportunidade_item (oportunidade_id, numero, descricao, tipo, quantidade, unidade, valor_unitario_estimado, valor_total_estimado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (oportunidade_id, numero) DO UPDATE
           SET descricao = EXCLUDED.descricao, tipo = EXCLUDED.tipo, quantidade = EXCLUDED.quantidade, unidade = EXCLUDED.unidade,
               valor_unitario_estimado = EXCLUDED.valor_unitario_estimado, valor_total_estimado = EXCLUDED.valor_total_estimado, coletado_em = now()`,
        [oportunidadeId, i.numero, i.descricao, i.tipo, i.quantidade, i.unidade, i.valorUnitarioEstimado, i.valorTotalEstimado],
      );
    }
    const { rows } = await db.query<{ versao: number; chave_canonica: string }>(
      `UPDATE integracao.oportunidade SET status_processamento = 'processada', processada_em = now() WHERE id = $1 RETURNING versao, chave_canonica`,
      [oportunidadeId],
    );
    await registrarEvento(db, 'oportunidade.pronta_para_avaliacao', oportunidadeId, {
      chave: rows[0]?.chave_canonica,
      versao: rows[0]?.versao,
      documentos: documentos.length,
      itens: itens.length,
    });
  });
}

export async function marcarErroProcessamento(oportunidadeId: string): Promise<void> {
  await obterPool().query(`UPDATE integracao.oportunidade SET status_processamento = 'erro' WHERE id = $1`, [oportunidadeId]);
}
