/** Consultas de leitura usadas pela API interna. Saída no formato do contrato (src/contrato). */
import { VERSAO_CONTRATO, type Oportunidade } from '../contrato/oportunidade.js';
import { obterPool } from '../db/pool.js';

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

type Linha = Record<string, any>;

function montarOportunidade(o: Linha, extras: { documentos: Linha[]; itens: Linha[]; origens: Linha[]; historico: Linha[] }): Oportunidade {
  return {
    versaoContrato: VERSAO_CONTRATO,
    id: o.id,
    chaveCanonica: o.chave_canonica,
    identificacao: { numeroControlePncp: o.numero_controle_pncp, numeroCompra: o.numero_compra, ano: o.ano, processo: o.processo },
    objeto: o.objeto,
    informacaoComplementar: o.informacao_complementar,
    orgao: { cnpj: o.orgao_cnpj, nome: o.orgao_nome, unidade: o.unidade_nome, municipio: o.municipio, uf: o.uf, esfera: o.esfera },
    modalidade: { idPncp: o.modalidade_id_pncp, nome: o.modalidade_nome },
    situacao: o.situacao,
    srp: o.srp,
    amparoLegal: o.amparo_legal,
    datas: {
      publicacao: iso(o.data_publicacao),
      aberturaPropostas: iso(o.data_abertura_propostas),
      encerramentoPropostas: iso(o.data_encerramento_propostas),
      atualizacaoFonte: iso(o.data_atualizacao_fonte),
    },
    valor: { estimado: o.valor_estimado, homologado: o.valor_homologado, moeda: 'BRL' },
    linkOficial: o.link_oficial,
    linkSistemaOrigem: o.link_sistema_origem,
    termosDicionario: o.termos_dicionario,
    statusProcessamento: o.status_processamento,
    documentos: extras.documentos.map((d) => ({
      id: d.id,
      fonte: d.fonte_id,
      idExterno: d.id_externo,
      titulo: d.titulo,
      tipo: d.tipo,
      url: d.url,
      publicadoEm: iso(d.publicado_em),
      coletadoEm: iso(d.coletado_em)!,
    })),
    itens: extras.itens.map((i) => ({
      numero: i.numero,
      descricao: i.descricao,
      tipo: i.tipo,
      quantidade: i.quantidade,
      unidade: i.unidade,
      valorUnitarioEstimado: i.valor_unitario_estimado,
      valorTotalEstimado: i.valor_total_estimado,
    })),
    origens: extras.origens.map((f) => ({
      fonte: f.fonte_id,
      idExterno: f.id_externo,
      urlOrigem: f.url_origem,
      primeiraColetaEm: iso(f.primeira_coleta_em)!,
      ultimaColetaEm: iso(f.ultima_coleta_em)!,
    })),
    primeiraColetaEm: iso(o.primeira_coleta_em)!,
    atualizadaEm: iso(o.atualizada_em)!,
    versao: o.versao,
    historico: extras.historico.map((h) => ({ versao: h.versao, tipo: h.tipo, fonte: h.fonte_id, alteradoEm: iso(h.alterado_em)!, camposAlterados: h.campos_alterados })),
  };
}

export async function obterOportunidade(id: string): Promise<Oportunidade | null> {
  const db = obterPool();
  const o = (await db.query('SELECT * FROM integracao.oportunidade WHERE id = $1', [id])).rows[0];
  if (!o) return null;
  const [documentos, itens, origens, historico] = await Promise.all([
    db.query('SELECT * FROM integracao.documento WHERE oportunidade_id = $1 AND ativo ORDER BY publicado_em NULLS LAST, id_externo', [id]),
    db.query('SELECT * FROM integracao.oportunidade_item WHERE oportunidade_id = $1 ORDER BY numero', [id]),
    db.query('SELECT fonte_id, id_externo, url_origem, primeira_coleta_em, ultima_coleta_em FROM integracao.oportunidade_fonte WHERE oportunidade_id = $1 ORDER BY primeira_coleta_em', [id]),
    db.query('SELECT * FROM integracao.oportunidade_historico WHERE oportunidade_id = $1 ORDER BY versao', [id]),
  ]);
  return montarOportunidade(o, { documentos: documentos.rows, itens: itens.rows, origens: origens.rows, historico: historico.rows });
}

export type FiltroLista = {
  q?: string;
  uf?: string;
  modalidade?: number;
  fonte?: string;
  status?: string;
  abertas?: boolean;
  atualizadasDesde?: string;
  pagina: number;
  tamanho: number;
};

export async function listarOportunidades(f: FiltroLista) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.q) where.push(`(o.objeto ILIKE ${p(`%${f.q}%`)} OR o.orgao_nome ILIKE $${params.length})`);
  if (f.uf) where.push(`o.uf = ${p(f.uf.toUpperCase())}`);
  if (f.modalidade) where.push(`o.modalidade_id_pncp = ${p(f.modalidade)}`);
  if (f.status) where.push(`o.status_processamento = ${p(f.status)}`);
  if (f.fonte) where.push(`EXISTS (SELECT 1 FROM integracao.oportunidade_fonte s WHERE s.oportunidade_id = o.id AND s.fonte_id = ${p(f.fonte)})`);
  if (f.abertas) where.push(`NOT o.cancelada AND (o.data_encerramento_propostas IS NULL OR o.data_encerramento_propostas > now())`);
  if (f.atualizadasDesde) where.push(`o.atualizada_em >= ${p(f.atualizadasDesde)}`);
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = obterPool();
  const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM integracao.oportunidade o ${filtro}`, params)).rows[0]!.n;
  const { rows } = await db.query(
    `SELECT o.id, o.chave_canonica, o.numero_controle_pncp, o.objeto, o.orgao_nome, o.uf, o.municipio, o.modalidade_nome,
            o.situacao, o.data_publicacao, o.data_encerramento_propostas, o.valor_estimado, o.link_oficial, o.termos_dicionario,
            o.status_processamento, o.versao, o.atualizada_em,
            (SELECT array_agg(DISTINCT s.fonte_id) FROM integracao.oportunidade_fonte s WHERE s.oportunidade_id = o.id) AS fontes
       FROM integracao.oportunidade o ${filtro}
      ORDER BY o.atualizada_em DESC, o.id
      LIMIT ${p(f.tamanho)} OFFSET ${p((f.pagina - 1) * f.tamanho)}`,
    params,
  );
  return {
    versaoContrato: VERSAO_CONTRATO,
    pagina: f.pagina,
    tamanho: f.tamanho,
    total,
    itens: rows.map((o) => ({
      id: o.id,
      chaveCanonica: o.chave_canonica,
      numeroControlePncp: o.numero_controle_pncp,
      objeto: o.objeto,
      orgao: o.orgao_nome,
      uf: o.uf,
      municipio: o.municipio,
      modalidade: o.modalidade_nome,
      situacao: o.situacao,
      publicacao: iso(o.data_publicacao),
      encerramentoPropostas: iso(o.data_encerramento_propostas),
      valorEstimado: o.valor_estimado,
      linkOficial: o.link_oficial,
      termosDicionario: o.termos_dicionario,
      statusProcessamento: o.status_processamento,
      fontes: o.fontes ?? [],
      versao: o.versao,
      atualizadaEm: iso(o.atualizada_em),
    })),
  };
}

export async function listarEventos(apos: number, limite: number, tipo?: string) {
  const { rows } = await obterPool().query(
    `SELECT id, tipo, agregado_id, payload, criado_em FROM integracao.evento_saida
      WHERE id > $1 AND ($3::text IS NULL OR tipo = $3) ORDER BY id LIMIT $2`,
    [apos, limite, tipo ?? null],
  );
  return rows.map((e) => ({ id: e.id, tipo: e.tipo, agregadoId: e.agregado_id, payload: e.payload, criadoEm: iso(e.criado_em) }));
}

export async function listarExecucoes(fonte: string | undefined, limite: number) {
  const { rows } = await obterPool().query(
    `SELECT * FROM integracao.execucao_coleta WHERE ($1::text IS NULL OR fonte_id = $1) ORDER BY iniciada_em DESC LIMIT $2`,
    [fonte ?? null, limite],
  );
  return rows;
}

export async function listarDuplicatas(status: string, limite: number) {
  const { rows } = await obterPool().query(
    `SELECT d.*, a.objeto AS objeto_a, a.chave_canonica AS chave_a, b.objeto AS objeto_b, b.chave_canonica AS chave_b
       FROM integracao.possivel_duplicata d
       JOIN integracao.oportunidade a ON a.id = d.oportunidade_a
       JOIN integracao.oportunidade b ON b.id = d.oportunidade_b
      WHERE d.status = $1 ORDER BY d.detectada_em DESC LIMIT $2`,
    [status, limite],
  );
  return rows;
}

/** Saúde por fonte: última execução, última com sucesso e atraso. */
export async function saudeFontes() {
  const { rows } = await obterPool().query(
    `SELECT f.id, f.nome, f.habilitada,
            (SELECT row_to_json(e) FROM (SELECT id, status, iniciada_em, finalizada_em, duracao_ms, registros_lidos, registros_aderentes, novas, atualizadas, erros
                                           FROM integracao.execucao_coleta WHERE fonte_id = f.id ORDER BY iniciada_em DESC LIMIT 1) e) AS ultima_execucao,
            (SELECT max(finalizada_em) FROM integracao.execucao_coleta WHERE fonte_id = f.id AND status IN ('sucesso','parcial')) AS ultimo_sucesso
       FROM integracao.fonte f ORDER BY f.id`,
  );
  return rows;
}

export async function listarCardsTrello(lista: string | undefined, limite: number, pagina: number) {
  const { rows } = await obterPool().query(
    `SELECT c.id_externo AS id, c.nome, c.descricao, c.lista_id, l.nome AS lista_nome, c.etiquetas, c.prazo, c.prazo_concluido,
            c.arquivado, c.url, c.ultima_atividade, c.versao, c.sincronizado_em,
            (SELECT coalesce(json_agg(json_build_object('numeroControlePncp', v.numero_controle_pncp, 'oportunidadeId', v.oportunidade_id)), '[]')
               FROM integracao.trello_card_oportunidade v WHERE v.card_id = c.id_externo) AS oportunidades
       FROM integracao.trello_card c LEFT JOIN integracao.trello_lista l ON l.id_externo = c.lista_id
      WHERE ($1::text IS NULL OR c.lista_id = $1)
      ORDER BY c.ultima_atividade DESC NULLS LAST LIMIT $2 OFFSET $3`,
    [lista ?? null, limite, (pagina - 1) * limite],
  );
  return rows;
}

export async function obterCardTrello(id: string) {
  const db = obterPool();
  const card = (await db.query('SELECT * FROM integracao.trello_card WHERE id_externo = $1', [id])).rows[0];
  if (!card) return null;
  const [checklists, anexos, acoes, etiquetas] = await Promise.all([
    db.query('SELECT id_externo AS id, nome, itens FROM integracao.trello_checklist WHERE card_id = $1', [id]),
    db.query('SELECT id_externo AS id, nome, url, mime, bytes, criado_em FROM integracao.trello_anexo WHERE card_id = $1 ORDER BY criado_em', [id]),
    db.query('SELECT id_externo AS id, tipo, ocorrida_em, membro_id, texto, lista_origem, lista_destino FROM integracao.trello_acao WHERE card_id = $1 ORDER BY ocorrida_em', [id]),
    db.query('SELECT id_externo AS id, nome, cor FROM integracao.trello_etiqueta WHERE id_externo = ANY($1)', [card.etiquetas]),
  ]);
  const { payload: _p, hash_conteudo: _h, ...resto } = card;
  return { ...resto, etiquetas: etiquetas.rows, checklists: checklists.rows, anexos: anexos.rows, historico: acoes.rows };
}
