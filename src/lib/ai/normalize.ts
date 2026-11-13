/**
 * Normalização da saída do LLM antes da validação.
 *
 * Modelos de linguagem são inconsistentes: devolvem `""`, `null`, `"N/A"`,
 * campos ausentes, listas com itens vazios ou `status` incoerente com o valor.
 * Aqui padronizamos tudo isso para que o schema Zod valide com previsibilidade
 * e para que a interface nunca receba uma "informação fantasma".
 */
import { z } from 'zod';
import { AppError } from '../errors';
import { analiseSchema, type AnaliseEditais, type Evidence } from '../schema';

const EMPTY_VALUES = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'nao',
  'não',
  'null',
  'undefined',
  'none',
  'nao informado',
  'não informado',
  'nao identificado',
  'não identificado',
  'não identificado no documento.',
  'nao identificado no documento.',
  'sem informacao',
  'sem informação',
]);

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    return EMPTY_VALUES.has(value.trim().toLowerCase());
  }
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const parts = value.map(asString).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join(' · ') : null;
  }
  if (typeof value === 'object') {
    // Alguns modelos aninham {valor: "..."} em vez de usar o campo `value`.
    const record = value as Record<string, unknown>;
    for (const key of ['valor', 'value', 'texto', 'text', 'descricao', 'descrição']) {
      if (key in record) {
        const nested = asString(record[key]);
        if (nested) return nested;
      }
    }
    try {
      return JSON.stringify(record);
    } catch {
      return null;
    }
  }
  return null;
}

/** Converte qualquer entrada em uma `Evidence` coerente. */
export function normalizeEvidence(input: unknown, fallbackReason?: string): Evidence {
  // Sentinela textual ("N/A", "não informado", "-") nunca é informação real.
  if (isBlank(input)) return { status: 'not_found', value: null };

  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    const value = asString(input);
    return value ? { status: 'found', value } : { status: 'not_found', value: null };
  }

  if (Array.isArray(input)) {
    const value = asString(input);
    return value ? { status: 'found', value } : { status: 'not_found', value: null };
  }

  if (typeof input === 'object') {
    const raw = input as Record<string, unknown>;
    const declaredStatus = normalizeItemStatus(raw.status);
    const value =
      asString(raw.value ?? raw.valor ?? raw.texto ?? raw.text ?? raw.descricao ?? raw.descrição) ??
      null;
    const quote = asString(raw.quote ?? raw.trecho ?? raw.citacao ?? raw.citação);
    const source = asString(raw.source ?? raw.pagina ?? raw.secao ?? raw.seção ?? raw.referencia);
    const reason = asString(raw.reason ?? raw.motivo ?? raw.justificativa) ?? fallbackReason ?? null;

    const status: Evidence['status'] = declaredStatus ?? 'found';

    // Sem valor não existe informação: rebaixamos para `not_found`, mesmo que o
    // modelo tenha declarado `found` ou `inferred`.
    if (status === 'not_found' || !value) {
      return { status: 'not_found', value: null, source };
    }

    // "Encontrado no edital" é uma afirmação forte. Sem trecho literal nem
    // página de origem não há como o usuário conferir: tratamos como inferência
    // (o relatório mostra o motivo e o selo correspondente) em vez de afirmar
    // que a informação foi localizada no documento.
    if (status === 'found' && !quote && !source) {
      return {
        status: 'inferred',
        value,
        quote,
        source,
        reason:
          reason ??
          'Valor informado pelo modelo sem trecho literal nem página de origem no documento. Confira antes de usar.',
      };
    }

    if (status === 'inferred') {
      return {
        status: 'inferred',
        value,
        quote,
        source,
        reason:
          reason ?? 'Informação deduzida a partir do contexto do documento, não declarada literalmente.',
      };
    }

    return { status: 'found', value, quote, source };
  }

  return { status: 'not_found', value: null };
}

/** Whitelist do status de itens de lista — o modelo varia muito a grafia. */
function normalizeItemStatus(raw: unknown): 'found' | 'inferred' | 'not_found' | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim().toLowerCase();
  if (key === 'found' || key === 'inferred' || key === 'not_found') return key;
  // Variações comuns em português/inglês.
  if (/^(encontrad|localizad|confirmad|explicit|present|sim|yes|true)/.test(key)) return 'found';
  if (/^(inferid|deduzid|estimad|presumid|indirect|indirect|inferred)/.test(key)) return 'inferred';
  if (/^(n[ãa]o|ausente|missing|unknown|null|not_?found|empty)/.test(key)) return 'not_found';
  return undefined;
}

function normalizeSourcedList(input: unknown): Array<{ text: string; source?: string | null }> {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  const output: Array<{ text: string; source?: string | null }> = [];

  for (const entry of list) {
    if (isBlank(entry)) continue;
    if (typeof entry === 'string') {
      const text = asString(entry);
      if (text) output.push({ text });
      continue;
    }
    if (typeof entry === 'object') {
      const raw = entry as Record<string, unknown>;
      const text = asString(
        raw.text ?? raw.texto ?? raw.item ?? raw.descricao ?? raw.descrição ?? raw.value ?? raw.valor,
      );
      if (!text) continue;
      const source = asString(raw.source ?? raw.pagina ?? raw.referencia);
      const status = normalizeItemStatus(raw.status);
      output.push({ text, source, ...(status ? { status } : {}) });
    }
  }

  // Remove duplicatas exatas preservando a ordem.
  const seen = new Set<string>();
  return output.filter((entry) => {
    const key = entry.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeItems(input: unknown) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list
    .map((entry) => {
      if (typeof entry === 'string') {
        const descricao = asString(entry);
        return descricao ? { descricao } : null;
      }
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;
      const descricao = asString(
        raw.descricao ?? raw.descrição ?? raw.item ?? raw.objeto ?? raw.produto ?? raw.servico,
      );
      if (!descricao) return null;
      return {
        numero: asString(raw.numero ?? raw.número ?? raw.num ?? raw.item_numero),
        descricao,
        quantidade: asString(raw.quantidade ?? raw.qtd ?? raw.quantity),
        unidade: asString(raw.unidade ?? raw.un ?? raw.unit),
        valorUnitario: asString(
          raw.valorUnitario ?? raw.valor_unitario ?? raw.valorUnit ?? raw.precoUnitario ?? raw['valor unitário'],
        ),
        valorTotal: asString(raw.valorTotal ?? raw.valor_total ?? raw.total),
        lote: asString(raw.lote ?? raw.grupo ?? raw.pacote),
        especificacoes: asString(
          raw.especificacoes ?? raw.especificações ?? raw.especificacao ?? raw.detalhes,
        ),
        source: asString(raw.source ?? raw.pagina),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function normalizeTimeline(input: unknown) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;
      const evento = asString(raw.evento ?? raw.event ?? raw.titulo ?? raw.título ?? raw.descricao);
      const data = asString(raw.data ?? raw.date ?? raw.prazo ?? raw.dataHora);
      if (!evento || !data) return null;
      const declared = typeof raw.status === 'string' ? raw.status.toLowerCase() : '';
      return {
        evento,
        data,
        hora: asString(raw.hora ?? raw.horario ?? raw.horário),
        status:
          declared === 'found' || declared === 'inferred' || declared === 'not_found'
            ? (declared as never)
            : ('found' as never),
        observacao: asString(raw.observacao ?? raw.observação ?? raw.obs ?? raw.nota),
        source: asString(raw.source ?? raw.pagina ?? raw.secao ?? raw.seção),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function normalizeAttention(input: unknown) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  const levelMap: Record<string, 'alto' | 'medio' | 'baixo'> = {
    alto: 'alto',
    alta: 'alto',
    high: 'alto',
    critico: 'alto',
    crítico: 'alto',
    medio: 'medio',
    média: 'medio',
    media: 'medio',
    moderado: 'medio',
    baixo: 'baixo',
    baixa: 'baixo',
    low: 'baixo',
  };
  return list
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;
      const titulo = asString(raw.titulo ?? raw.título ?? raw.ponto ?? raw.item);
      const motivo = asString(raw.motivo ?? raw.razao ?? raw.razão ?? raw.porque ?? raw.descricao);
      if (!titulo || !motivo) return null;
      const nivelRaw = asString(raw.nivel ?? raw.nível ?? raw.severidade ?? raw.gravidade) ?? 'medio';
      return {
        titulo,
        motivo,
        nivel: levelMap[nivelRaw.toLowerCase()] ?? 'medio',
        recomendacao: asString(raw.recomendacao ?? raw.recomendação ?? raw.acao ?? raw.ação),
        trecho: asString(raw.trecho ?? raw.quote ?? raw.citacao),
        source: asString(raw.source ?? raw.pagina ?? raw.secao ?? raw.seção),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function normalizeChecklist(input: unknown) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list
    .map((entry) => {
      if (typeof entry === 'string') {
        const item = asString(entry);
        return item ? { item, obrigatorio: true } : null;
      }
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;
      const item = asString(raw.item ?? raw.texto ?? raw.descricao ?? raw.descrição ?? raw.documento);
      if (!item) return null;
      const obrigatorioRaw = raw.obrigatorio ?? raw.obrigatório ?? raw.required;
      return {
        item,
        obrigatorio:
          typeof obrigatorioRaw === 'boolean'
            ? obrigatorioRaw
            : typeof obrigatorioRaw === 'string'
              ? /^(sim|true|1|obrigat)/i.test(obrigatorioRaw)
              : true,
        observacao: asString(raw.observacao ?? raw.observação ?? raw.nota ?? raw.detalhe),
        source: asString(raw.source ?? raw.pagina),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function normalizeDisputes(input: unknown) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list
    .map((entry) => {
      if (typeof entry === 'string') return asString(entry);
      if (entry && typeof entry === 'object') {
        const raw = entry as Record<string, unknown>;
        return asString(raw.nome ?? raw.name ?? raw.descricao ?? raw.descrição ?? raw.texto);
      }
      return null;
    })
    .filter((item): item is string => Boolean(item));
}

/**
 * Normaliza o payload bruto devolvido pelo LLM e valida contra o schema.
 *
 * A validação final é a última barreira: se ainda assim o payload não fechar,
 * convertemos o erro de schema em `AppError('AI_INVALID_RESPONSE')` — mais
 * honesto e seguro para o usuário do que um 500 genérico com a lista de
 * problemas internos do schema.
 *
 * @throws AppError quando a estrutura é irrecuperável.
 */
export function normalizeAnalysis(
  raw: unknown,
  context: { dataAnalise: string; paginas?: number; caracteres?: number },
): AnaliseEditais {
  // Payload que não é objeto (array, string, número) indica resposta inválida do
  // modelo: não faz sentido montar um esqueleto "vazio" e apresentá-lo como
  // análise.
  if (raw !== null && raw !== undefined && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new AppError('AI_INVALID_RESPONSE', 'A IA retornou uma estrutura inesperada.', {
      status: 502,
      details: `Tipo recebido: ${Array.isArray(raw) ? 'array' : typeof raw}.`,
      hint: 'Tente novamente. Se persistir, verifique o modelo configurado em DEEPSEEK_MODEL.',
    });
  }

  const input = (raw ?? {}) as Record<string, unknown>;
  const documento = (input.documento ?? {}) as Record<string, unknown>;
  const resumo = (input.resumoExecutivo ?? {}) as Record<string, unknown>;
  const geral = (input.informacoesGerais ?? {}) as Record<string, unknown>;
  const objeto = (input.objeto ?? {}) as Record<string, unknown>;
  const participacao = (input.participacao ?? {}) as Record<string, unknown>;
  const obrigacoes = (input.obrigacoes ?? {}) as Record<string, unknown>;
  const valores = (input.valores ?? {}) as Record<string, unknown>;
  const conclusao = (input.conclusao ?? {}) as Record<string, unknown>;
  const confianca = (input.confianca ?? {}) as Record<string, unknown>;

  const payload = {
    schemaVersion: '1.0',
    documento: {
      titulo:
        asString(documento.titulo ?? documento.título) ?? 'Edital de licitação',
      orgao:
        asString(documento.orgao ?? documento.orgão) ??
        asString(normalizeEvidence(geral.orgao).value),
      numeroEdital:
        asString(documento.numeroEdital ?? documento['númeroEdital']) ??
        asString(normalizeEvidence(geral.numeroEdital).value),
      modalidade: asString(documento.modalidade) ?? asString(normalizeEvidence(geral.modalidade).value),
      paginas: context.paginas,
      caracteres: context.caracteres,
      dataAnalise: context.dataAnalise,
    },
    resumoExecutivo: {
      visaoGeral:
        asString(resumo.visaoGeral ?? resumo['visãoGeral'] ?? resumo.resumo) ??
        'Não foi possível gerar o resumo executivo a partir do documento enviado.',
      destaques: normalizeSourcedList(resumo.destaques),
      alertaPrazo: asString(resumo.alertaPrazo ?? resumo.alerta_prazo ?? resumo.alerta),
      recomendacao:
        asString(resumo.recomendacao ?? resumo.recomendação) ??
        'Recomenda-se leitura integral do edital antes de decidir pela participação.',
    },
    informacoesGerais: {
      orgao: normalizeEvidence(geral.orgao),
      numeroEdital: normalizeEvidence(geral.numeroEdital ?? geral['númeroEdital'] ?? geral.numero),
      modalidade: normalizeEvidence(geral.modalidade),
      processo: normalizeEvidence(geral.processo ?? geral.processoAdministrativo),
      objeto: normalizeEvidence(geral.objeto),
      portal: normalizeEvidence(geral.portal ?? geral.plataforma),
      localDisputa: normalizeEvidence(geral.localDisputa ?? geral.local ?? geral.sessaoPublica),
      regimeExecucao: normalizeEvidence(geral.regimeExecucao ?? geral.regime),
      criterioJulgamento: normalizeEvidence(geral.criterioJulgamento ?? geral.criterio ?? geral['critérioJulgamento']),
      vigenciaContrato: normalizeEvidence(geral.vigenciaContrato ?? geral.vigencia ?? geral['vigênciaContrato']),
    },
    cronograma: normalizeTimeline(input.cronograma),
    outrosPrazos: normalizeTimeline(input.outrosPrazos),
    objeto: {
      resumo: asString(objeto.resumo ?? objeto.descricao ?? objeto.descrição) ?? 'Não identificado no documento.',
      descricaoDetalhada:
        asString(objeto.descricaoDetalhada ?? objeto['descriçãoDetalhada'] ?? objeto.detalhamento ?? objeto.descricao) ??
        'Não identificado no documento.',
      itens: normalizeItems(objeto.itens ?? objeto['itens'] ?? valores.itens),
      lotes: normalizeSourcedList(objeto.lotes),
      especificacoesTecnicas: normalizeSourcedList(
        objeto.especificacoesTecnicas ?? objeto['especificaçõesTécnicas'] ?? objeto.especificacoes,
      ),
    },
    participacao: {
      quemPodeParticipar: normalizeSourcedList(participacao.quemPodeParticipar),
      habilitacaoJuridica: normalizeSourcedList(participacao.habilitacaoJuridica ?? participacao['habilitaçãoJurídica']),
      habilitacaoFiscalTrabalhista: normalizeSourcedList(
        participacao.habilitacaoFiscalTrabalhista ?? participacao['habilitaçãoFiscalTrabalhista'] ?? participacao.habilitacaoFiscal,
      ),
      qualificacaoTecnica: normalizeSourcedList(participacao.qualificacaoTecnica ?? participacao['qualificaçãoTécnica']),
      qualificacaoEconomicoFinanceira: normalizeSourcedList(
        participacao.qualificacaoEconomicoFinanceira ?? participacao['qualificaçãoEconômicoFinanceira'] ?? participacao.qualificacaoEconomica,
      ),
      certidoes: normalizeSourcedList(participacao.certidoes ?? participacao.certidões),
      documentos: normalizeSourcedList(participacao.documentos ?? participacao.documentacao),
      restricoes: normalizeSourcedList(participacao.restricoes ?? participacao.restrições ?? participacao.impedimentos),
      exigenciasEspecificas: normalizeSourcedList(
        participacao.exigenciasEspecificas ?? participacao['exigênciasEspecíficas'] ?? participacao.exigencias,
      ),
      visitasOuAmostras: normalizeSourcedList(participacao.visitasOuAmostras ?? participacao.visita ?? participacao.amostra),
      consorcio: normalizeEvidence(participacao.consorcio ?? participacao.consórcio),
      meEpp: normalizeEvidence(participacao.meEpp ?? participacao.me_epp ?? participacao.tratamentoDiferenciado),
    },
    obrigacoes: {
      contratada: normalizeSourcedList(obrigacoes.contratada ?? obrigacoes.obrigacoesContratada ?? obrigacoes['obrigaçõesContratada']),
      contratante: normalizeSourcedList(obrigacoes.contratante ?? obrigacoes.obrigacoesContratante ?? obrigacoes['obrigaçõesContratante']),
      prazoExecucao: normalizeEvidence(obrigacoes.prazoExecucao ?? obrigacoes['prazoExecução'] ?? obrigacoes.prazo),
      prazoEntrega: normalizeEvidence(obrigacoes.prazoEntrega),
      condicoesPagamento: normalizeSourcedList(obrigacoes.condicoesPagamento ?? obrigacoes['condiçõesPagamento'] ?? obrigacoes.pagamento),
      garantias: normalizeSourcedList(obrigacoes.garantias ?? obrigacoes.garantia),
      penalidades: normalizeSourcedList(obrigacoes.penalidades ?? obrigacoes.sancoes ?? obrigacoes['sanções']),
      sancoes: normalizeSourcedList(obrigacoes.sancoes ?? obrigacoes['sanções']),
      subcontratacao: normalizeEvidence(obrigacoes.subcontratacao ?? obrigacoes['subcontratação']),
    },
    valores: {
      valorEstimado: normalizeEvidence(valores.valorEstimado ?? valores.valor ?? valores.estimado),
      valorMaximo: normalizeEvidence(valores.valorMaximo ?? valores['valorMáximo'] ?? valores.maximo),
      moeda: asString(valores.moeda) ?? 'BRL',
      itens: normalizeItems(valores.itens),
      observacoes: normalizeSourcedList(valores.observacoes ?? valores['observações']),
    },
    pontosDeAtencao: normalizeAttention(input.pontosDeAtencao ?? input['pontosDeAtenção']),
    checklist: normalizeChecklist(input.checklist),
    conclusao: {
      texto:
        asString(conclusao.texto ?? conclusao.resumo ?? conclusao.conclusao) ??
        'Análise concluída. Recomenda-se validação humana dos pontos de atenção antes de qualquer decisão.',
      proximosPassos: normalizeSourcedList(conclusao.proximosPassos ?? conclusao['próximosPassos']),
      limitacoesDaAnalise: normalizeDisputes(conclusao.limitacoesDaAnalise ?? conclusao['limitaçõesDaAnálise'] ?? conclusao.limitacoes),
    },
    confianca: asString(confianca.nivel ?? confianca['nível'] ?? confianca.justificativa)
      ? {
          nivel: (() => {
            const level = (asString(confianca.nivel ?? confianca['nível']) ?? 'media').toLowerCase();
            if (level.startsWith('a')) return 'alta' as const;
            if (level.startsWith('b')) return 'baixa' as const;
            return 'media' as const;
          })(),
          justificativa:
            asString(confianca.justificativa) ??
            'Confiança estimada a partir da quantidade de informação rastreável encontrada.',
        }
      : undefined,
  };

  // Última barreira: normalizar é tolerante, mas se ainda assim o payload não
  // fechar o schema, o erro vira um erro de domínio tratado em vez de um 500
  // com a lista de problemas internos exposta ao cliente.
  const parsed = analiseSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join(' | ');
    throw new AppError('AI_INVALID_RESPONSE', 'A análise retornada não passou na validação do schema.', {
      status: 502,
      details: issues,
      hint: 'Tente novamente. Se persistir, troque o modelo em DEEPSEEK_MODEL.',
    });
  }
  return parsed.data;
}

/** Schema tolerante usado na validação prévia (permite campos extras). */
export const looseAnaliseSchema = z.object({}).passthrough();

/**
 * O modelo às vezes encerra a resposta antes das seções finais. Checklist e
 * próximos passos derivam do que já foi extraído (documentos de habilitação e
 * cronograma), então são completados sem nova chamada — sempre com a fonte original.
 */
export function completarSecoesFinais(analise: AnaliseEditais): AnaliseEditais {
  if (analise.checklist.length === 0) {
    const p = analise.participacao;
    const grupos: Array<[string, Array<{ text: string; source?: string | null }> | undefined]> = [
      ['Habilitação jurídica', p.habilitacaoJuridica],
      ['Regularidade fiscal e trabalhista', p.habilitacaoFiscalTrabalhista],
      ['Certidões', p.certidoes],
      ['Qualificação técnica', p.qualificacaoTecnica],
      ['Qualificação econômico-financeira', p.qualificacaoEconomicoFinanceira],
      ['Documentos', p.documentos],
      ['Exigência específica', p.exigenciasEspecificas],
    ];
    const vistos = new Set<string>();
    for (const [grupo, itens] of grupos) {
      for (const item of itens ?? []) {
        const chave = item.text.trim().toLowerCase();
        if (!chave || vistos.has(chave) || analise.checklist.length >= 40) continue;
        vistos.add(chave);
        analise.checklist.push({ item: item.text, obrigatorio: true, observacao: grupo, source: item.source ?? null });
      }
    }
  }

  if (analise.conclusao.proximosPassos.length === 0) {
    const achar = (re: RegExp) => analise.cronograma.find((e) => re.test(e.evento));
    const quando = (e?: { data: string; hora?: string | null }) => (e ? ` até ${e.data}${e.hora ? ` às ${e.hora}` : ''}` : '');
    const esclarecimento = achar(/esclarec|impugna/i);
    // Prazo final para a proposta: encerramento/limite ou a sessão pública; nunca o início do recebimento.
    const proposta =
      achar(/(limite|encerramento|t[eé]rmino|fim).*(propost|recebimento)/i) ??
      achar(/abertura|sess[aã]o|disputa/i) ??
      [...analise.cronograma].reverse().find((e) => /propost/i.test(e.evento) && !/in[ií]cio/i.test(e.evento));
    const passos = [
      analise.checklist.length > 0 && { text: `Separar os ${analise.checklist.length} documentos do checklist e conferir a validade das certidões.`, source: null },
      analise.pontosDeAtencao.length > 0 && { text: 'Revisar os pontos de atenção antes de decidir participar.', source: null },
      esclarecimento && { text: `Enviar dúvidas ou impugnações${quando(esclarecimento)}.`, source: esclarecimento.source ?? null },
      { text: `Cadastrar a proposta no portal${quando(proposta)}.`, source: proposta?.source ?? null },
    ].filter(Boolean) as Array<{ text: string; source: string | null }>;
    analise.conclusao.proximosPassos.push(...passos);
  }

  return analise;
}

/**
 * O modelo às vezes devolve seções inteiras vazias (participação, obrigações,
 * cronograma) mesmo quando o edital as traz. Para cada lista vazia, usa o que o
 * extrator determinístico encontrou no mesmo documento — sempre com página de
 * origem. Devolve os nomes das seções completadas, para o aviso ao usuário.
 */
export function completarComExtratorLocal(ia: AnaliseEditais, local: AnaliseEditais): string[] {
  const completadas: string[] = [];
  const listas = <T extends Record<string, unknown>>(alvo: T, fonte: T, secao: string) => {
    let mudou = false;
    for (const [chave, valor] of Object.entries(fonte)) {
      const atual = alvo[chave];
      if (Array.isArray(valor) && valor.length > 0 && (!Array.isArray(atual) || atual.length === 0)) {
        (alvo as Record<string, unknown>)[chave] = valor;
        mudou = true;
      }
    }
    if (mudou) completadas.push(secao);
  };

  listas(ia.participacao, local.participacao, 'participação');
  listas(ia.obrigacoes, local.obrigacoes, 'obrigações');
  if (ia.cronograma.length === 0 && local.cronograma.length > 0) {
    ia.cronograma = local.cronograma;
    completadas.push('cronograma');
  }
  if (ia.checklist.length === 0 && local.checklist.length > 0) {
    ia.checklist = local.checklist;
    completadas.push('checklist');
  }
  return completadas;
}
