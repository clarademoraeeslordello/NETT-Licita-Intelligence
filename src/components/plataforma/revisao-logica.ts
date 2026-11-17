/**
 * Lógica pura da tela de revisão humana (T-405). Sem React nem rede: testável com `npm run test:ui`.
 * O servidor é a autoridade (T-304): confere `previous` contra o valor atual e a regra de cada decisão.
 */

export type StatusRevisao = 'pending_review' | 'approved' | 'approved_with_changes' | 'rejected' | 'superseded';
export type Decisao = 'approved' | 'approved_with_changes' | 'rejected';

export const ROTULO_STATUS: Record<StatusRevisao, string> = {
  pending_review: 'Aguardando revisão',
  approved: 'Aprovada',
  approved_with_changes: 'Aprovada com ajustes',
  rejected: 'Rejeitada',
  superseded: 'Substituída por análise mais recente',
};
export const ROTULO_DECISAO: Record<Decisao, string> = { approved: 'Aprovou', approved_with_changes: 'Aprovou com ajustes', rejected: 'Rejeitou' };

export const ROTULO_EVIDENCIA = { found: 'Encontrado no edital', inferred: 'Inferido', not_found: 'Não identificado' } as const;

/** Campos de `tender_summary` com evidência (status + valor + trecho + página). Caminho = chave no resultado. */
export const CAMPOS_EVIDENCIA: Array<{ path: string; rotulo: string }> = [
  { path: 'informacoesGerais.orgao', rotulo: 'Órgão' },
  { path: 'informacoesGerais.numeroEdital', rotulo: 'Número do edital' },
  { path: 'informacoesGerais.modalidade', rotulo: 'Modalidade' },
  { path: 'informacoesGerais.processo', rotulo: 'Processo' },
  { path: 'informacoesGerais.objeto', rotulo: 'Objeto' },
  { path: 'informacoesGerais.portal', rotulo: 'Portal' },
  { path: 'informacoesGerais.localDisputa', rotulo: 'Local da disputa' },
  { path: 'informacoesGerais.regimeExecucao', rotulo: 'Regime de execução' },
  { path: 'informacoesGerais.criterioJulgamento', rotulo: 'Critério de julgamento' },
  { path: 'informacoesGerais.vigenciaContrato', rotulo: 'Vigência do contrato' },
  { path: 'valores.valorEstimado', rotulo: 'Valor estimado' },
  { path: 'valores.valorMaximo', rotulo: 'Valor máximo' },
  { path: 'obrigacoes.prazoExecucao', rotulo: 'Prazo de execução' },
  { path: 'obrigacoes.prazoEntrega', rotulo: 'Prazo de entrega' },
  { path: 'obrigacoes.subcontratacao', rotulo: 'Subcontratação' },
  { path: 'participacao.consorcio', rotulo: 'Consórcio' },
  { path: 'participacao.meEpp', rotulo: 'Benefício ME/EPP' },
];

export type Valor = string | number | null;
export type BlocoEvidencia = {
  /** Caminho do VALOR a corrigir (termina em `.value`), como o servidor espera. */
  path: string;
  rotulo: string;
  status: 'found' | 'inferred' | 'not_found';
  valor: Valor;
  trecho: string | null;
  fonte: string | null;
  motivo: string | null;
};

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function noCaminho(raiz: unknown, caminho: string): unknown {
  let atual: unknown = raiz;
  for (const parte of caminho.split('.')) {
    if (!ehObjeto(atual) || !Object.hasOwn(atual, parte)) return undefined;
    atual = atual[parte];
  }
  return atual;
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/**
 * Blocos de evidência corrigíveis. Só entra quem tem a chave `value` presente: o servidor recusa correção em
 * caminho inexistente (resolvePath usa hasOwn), então oferecer o botão nesses casos geraria erro garantido.
 */
export function blocosEvidencia(resultado: unknown): BlocoEvidencia[] {
  const saida: BlocoEvidencia[] = [];
  for (const { path, rotulo } of CAMPOS_EVIDENCIA) {
    const ev = noCaminho(resultado, path);
    if (!ehObjeto(ev) || !Object.hasOwn(ev, 'value')) continue;
    const status = ev.status === 'found' || ev.status === 'inferred' || ev.status === 'not_found' ? ev.status : 'not_found';
    const v = ev.value;
    saida.push({
      path: `${path}.value`,
      rotulo,
      status,
      valor: typeof v === 'string' || typeof v === 'number' ? v : null,
      trecho: texto(ev.quote),
      fonte: texto(ev.source),
      motivo: texto(ev.reason),
    });
  }
  return saida;
}

export type Correcao = { path: string; previous: Valor; corrected: Valor; note: string | null };

/**
 * Converte o texto digitado em correção. Vazio vira `null` (o campo passa a "sem valor"). Se o valor anterior era
 * número e o texto é um número simples, mantém número. Devolve null quando nada mudou (sem correção vazia).
 */
export function montarCorrecao(bloco: Pick<BlocoEvidencia, 'path' | 'valor'>, digitado: string, nota: string | null = null): Correcao | null {
  const t = digitado.trim();
  let corrigido: Valor = t === '' ? null : t;
  if (typeof bloco.valor === 'number' && corrigido !== null && /^-?\d+(\.\d+)?$/.test(corrigido)) corrigido = Number(corrigido);
  if (corrigido === bloco.valor) return null;
  const n = nota?.trim();
  return { path: bloco.path, previous: bloco.valor, corrected: corrigido, note: n ? n : null };
}

export type Painel = { decisao: Decisao; podeEnviar: boolean; motivo: string | null };

/**
 * Decisão resultante do que a pessoa fez: com correções, "aprovar" vira `approved_with_changes` (o contrato exige
 * correções nesse caso e proíbe-as sem ele). Rejeitar exige comentário.
 */
export function resolverDecisao(escolha: 'approve' | 'reject', correcoes: number, comentario: string): Painel {
  if (escolha === 'reject') {
    const ok = comentario.trim().length > 0;
    return { decisao: 'rejected', podeEnviar: ok, motivo: ok ? null : 'Explique o motivo da rejeição.' };
  }
  return { decisao: correcoes > 0 ? 'approved_with_changes' : 'approved', podeEnviar: true, motivo: null };
}

/** Rejeitar descarta correções: o servidor só aceita `corrections` com `approved_with_changes`. */
export function corpoDaRevisao(analiseId: string, escolha: 'approve' | 'reject', correcoes: Correcao[], comentario: string) {
  const { decisao } = resolverDecisao(escolha, correcoes.length, comentario);
  return {
    subjectType: 'ai_analysis' as const,
    subjectId: analiseId,
    decision: decisao,
    corrections: decisao === 'approved_with_changes' ? correcoes : [],
    comment: comentario.trim() || undefined,
  };
}

/* ------------------------------ fit_assessment ------------------------------ */

export const ROTULO_RECOMENDACAO = { participate: 'Sugere participar', evaluate: 'Sugere avaliar com cuidado', discard: 'Sugere descartar' } as const;
export const ROTULO_NIVEL = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;
export const ROTULO_EVIDENCIA_FIT = { proven: 'Comprovado', inferred: 'Inferido', unverified: 'Não verificado' } as const;
export const ROTULO_SITUACAO_REQUISITO = { met: 'Atendido', met_declared: 'Atendido (declarado)', not_met: 'Não atendido', unverified: 'Não verificado' } as const;
