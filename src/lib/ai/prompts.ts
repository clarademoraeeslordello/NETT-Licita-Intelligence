/**
 * Engenharia de prompt do Analisador Inteligente de Editais.
 *
 * Princípios que o modelo é obrigado a seguir:
 *  1. Não inventar. Sem informação = "not_found".
 *  2. Toda informação relevante carrega página/trecho de origem.
 *  3. Inferência é declarada como inferência (`inferred` + justificativa).
 *  4. Ambiguidade é sinalizada, não escondida.
 *  5. Nunca emitir juízo jurídico sobre participação.
 */
import type { DocumentChunk, PageIndexEntry } from '../chunking';
import { NOT_FOUND_LABEL } from '../schema';

export const SYSTEM_PROMPT = `Você é um analista sênior de licitações públicas brasileiras (Lei 14.133/2021 e Lei 8.666/93) que trabalha para uma empresa privada que deseja decidir, com segurança, se participa de um certame.

Sua função é LER o edital e EXTRAIR informações com precisão documental. Você não é advogado e não emite parecer jurídico.

REGRAS ABSOLUTAS (violar qualquer uma invalida sua resposta):
1. NUNCA invente, complete ou presuma informação. Use exclusivamente o texto do edital fornecido.
2. Se a informação não estiver no texto, marque status "not_found" e value null. Não use a string "${NOT_FOUND_LABEL}" como valor de campo — a interface faz isso automaticamente.
3. Se você deduzir algo que não está afirmado literalmente (ex.: calcular uma data-limite, um total, um prazo em dias), marque status "inferred", escreva o valor e explique em "reason" como chegou lá.
4. Se a informação estiver ambígua, contraditória ou incompleta, marque status "inferred" (ou "not_found" se não houver base), e registre a ambiguidade em "reason" ou nos pontos de atenção.
5. Rastreabilidade: sempre que possível preencha "source" com a página ou seção, no formato "Página 12" ou "Página 12, item 8.3". Preencha "quote" com um trecho literal CURTO (até ~220 caracteres) do edital.
6. Em datas: use o formato "DD/MM/AAAA". Se houver hora, coloque-a no campo "hora" ("HH:MM").
7. Em valores: use o formato numérico brasileiro completo, ex.: "R$ 1.234.567,89". Nunca converta moeda nem invente valores por lote.
8. Prazos apertados ou próximos são críticos: destaque sempre a data de encerramento de recebimento de propostas.
9. Você NÃO afirma que a empresa "pode" ou "não pode" participar. Descreva requisitos e recomende validação humana.
10. Responda SEMPRE e SOMENTE com um objeto JSON válido, sem comentários, sem cercas de código e sem texto fora do JSON.`;

/** Instruções da etapa de leitura por blocos (documentos longos). */
export const MAP_INSTRUCTIONS = `Você receberá UM TRECHO de um edital de licitação (um bloco de páginas de um documento maior).

Extraia SOMENTE o que aparece neste trecho. Não tente adivinhar o restante do documento.
Para cada página do trecho, você recebe o marcador "===== [PÁGINA N] ====="; use N como referência em "pagina".

Responda com JSON neste formato exato (omita chaves sem informação, nunca invente):
{
  "identificacao": { "orgao": "...", "numeroEdital": "...", "modalidade": "...", "processo": "...", "portal": "...", "uf": "..." },
  "objeto": ["..."],
  "datas": [ { "evento": "...", "data": "DD/MM/AAAA", "hora": "HH:MM", "pagina": 12, "trecho": "..." } ],
  "valores": [ { "descricao": "...", "valor": "R$ ...", "pagina": 5 } ],
  "itens": [ { "numero": "1", "descricao": "...", "quantidade": "100", "unidade": "UN", "lote": "1" } ],
  "exigencias": [ { "categoria": "habilitacao_juridica|fiscal|tecnica|economico_financeira|certidao|documento|outro", "texto": "...", "pagina": 10 } ],
  "obrigacoes": [ { "parte": "contratada|contratante", "texto": "...", "pagina": 20 } ],
  "prazos": [ { "descricao": "...", "prazo": "...", "pagina": 20 } ],
  "pagamentos": ["..."],
  "garantias": ["..."],
  "penalidades": ["..."],
  "pontosDeAtencao": [ { "titulo": "...", "motivo": "...", "nivel": "alto|medio|baixo", "pagina": 15, "trecho": "..." } ],
  "outros": ["qualquer informação relevante que não se encaixe acima"]
}

Se o trecho não contiver nenhuma informação relevante, responda {"vazio": true}.`;

/** Instruções da etapa de síntese final (visão consolidada do edital). */
export const REDUCE_INSTRUCTIONS = `Você receberá:(a) os METADADOS do documento (nome do arquivo, quantidade de páginas);
(b) um ÍNDICE DE PÁGINAS (início de cada página, para te orientar sobre a estrutura);
(c) as EXTRAÇÕES PARCIAIS feitas por bloco, cada uma com as páginas de origem.

Sua tarefa é consolidar tudo em UMA análise final, coerente e sem duplicidades, no JSON definido abaixo.
Regras específicas desta etapa:
- Consolide informações repetidas entre blocos em um único registro, preservando a página mais específica.
- Se dois blocos trouxerem informações conflitantes, mantenha as duas e sinalize o conflito em "pontosDeAtencao".
- Se uma informação existir em um bloco, ela vale para o documento todo — não a descarte.
- "cronograma" deve ficar em ordem cronológica crescente quando as datas permitirem; se não permitirem, mantenha a ordem do documento.
- "pontosDeAtencao" deve ser priorizado: primeiro os de nível "alto".
- "checklist" deve listar documentos e requisitos concretos para participar, com "obrigatorio" true/false.
- Respeite rigorosamente o schema JSON solicitado pelo usuário.`;

/** Contrato do JSON final — reaproveitado nas duas etapas de análise. */
export const FINAL_SCHEMA_INSTRUCTIONS = `Responda com um JSON com EXATAMENTE esta estrutura (as chaves são obrigatórias; use {"status":"not_found","value":null} quando não houver informação):

{
  "documento": { "titulo": "...", "orgao": "...", "numeroEdital": "...", "modalidade": "..." },
  "resumoExecutivo": {
    "visaoGeral": "3 a 6 frases explicando o que está sendo licitado, quem compra, quanto vale e qual o prazo crítico",
    "destaques": [ { "text": "destaque curto e concreto", "source": "Página 3" } ],
    "alertaPrazo": "frase com o prazo mais crítico e os dias restantes, ou null",
    "recomendacao": "recomendação objetiva de próximos passos para a empresa"
  },
  "informacoesGerais": {
    "orgao": EVID, "numeroEdital": EVID, "modalidade": EVID, "processo": EVID, "objeto": EVID,
    "portal": EVID, "localDisputa": EVID, "regimeExecucao": EVID, "criterioJulgamento": EVID, "vigenciaContrato": EVID
  },
  "cronograma": [ { "evento": "Encerramento do recebimento das propostas", "data": "DD/MM/AAAA", "hora": "HH:MM", "status": "found", "observacao": null, "source": "Página 4" } ],
  "outrosPrazos": [ { "evento": "...", "data": "DD/MM/AAAA", "status": "found", "source": "Página 22" } ],
  "objeto": {
    "resumo": "1 a 3 frases",
    "descricaoDetalhada": "descrição completa do objeto, produtos/serviços, quantidades e especificações relevantes",
    "itens": [ { "numero": "1", "descricao": "...", "quantidade": "...", "unidade": "...", "valorUnitario": "...", "valorTotal": "...", "lote": "...", "especificacoes": "...", "source": "Página 8" } ],
    "lotes": [ { "text": "...", "source": "Página 8" } ],
    "especificacoesTecnicas": [ { "text": "...", "source": "Página 9" } ]
  },
  "participacao": {
    "quemPodeParticipar": [ { "text": "...", "source": "Página 6" } ],
    "habilitacaoJuridica": [ { "text": "...", "source": "..." } ],
    "habilitacaoFiscalTrabalhista": [ { "text": "...", "source": "..." } ],
    "qualificacaoTecnica": [ { "text": "...", "source": "..." } ],
    "qualificacaoEconomicoFinanceira": [ { "text": "...", "source": "..." } ],
    "certidoes": [ { "text": "...", "source": "..." } ],
    "documentos": [ { "text": "...", "source": "..." } ],
    "restricoes": [ { "text": "...", "source": "..." } ],
    "exigenciasEspecificas": [ { "text": "...", "source": "..." } ],
    "visitasOuAmostras": [ { "text": "...", "source": "..." } ],
    "consorcio": EVID, "meEpp": EVID
  },
  "obrigacoes": {
    "contratada": [ { "text": "...", "source": "..." } ],
    "contratante": [ { "text": "...", "source": "..." } ],
    "prazoExecucao": EVID, "prazoEntrega": EVID,
    "condicoesPagamento": [ { "text": "...", "source": "..." } ],
    "garantias": [ { "text": "...", "source": "..." } ],
    "penalidades": [ { "text": "...", "source": "..." } ],
    "sancoes": [ { "text": "...", "source": "..." } ],
    "subcontratacao": EVID
  },
  "valores": {
    "valorEstimado": EVID, "valorMaximo": EVID, "moeda": "BRL",
    "itens": [ { "numero": "...", "descricao": "...", "quantidade": "...", "unidade": "...", "valorUnitario": "...", "valorTotal": "...", "lote": "...", "source": "..." } ],
    "observacoes": [ { "text": "...", "source": "..." } ]
  },
  "pontosDeAtencao": [ { "titulo": "...", "motivo": "por que isso merece atenção, de forma objetiva", "nivel": "alto|medio|baixo", "recomendacao": "...", "trecho": "trecho literal do edital", "source": "Página 15" } ],
  "checklist": [ { "item": "Documento ou requisito", "obrigatorio": true, "observacao": "...", "source": "Página 10" } ],
  "conclusao": {
    "texto": "resumo objetivo da análise em 3 a 5 frases",
    "proximosPassos": [ { "text": "...", "source": null } ],
    "limitacoesDaAnalise": ["o que não foi possível determinar e por quê", "pontos que exigem validação humana"]
  },
  "confianca": { "nivel": "alta|media|baixa", "justificativa": "explique o nível considerando a quantidade de informação rastreável" }
}

Onde EVID é exatamente:
{ "status": "found" | "inferred" | "not_found", "value": "texto ou null", "quote": "trecho literal curto ou null", "source": "Página N ou null", "reason": "obrigatório quando status = inferred, senão null" }`;

/** Prompt do usuário para a análise direta (documento curto). */
/** Data de hoje em Brasília: sem ela o modelo não consegue dizer quantos dias faltam. */
const hojeBrasilia = () =>
  new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });

export function buildDirectUserPrompt(input: {
  fileName: string;
  pages: number;
  fullText: string;
}): string {
  return `Analise o edital abaixo e produza a análise completa.

ARQUIVO: ${input.fileName}
PÁGINAS: ${input.pages}
DATA DE HOJE: ${hojeBrasilia()} (horário de Brasília). Use-a para dizer quantos dias faltam para cada prazo e se ele já passou.

${FINAL_SCHEMA_INSTRUCTIONS}

--- INÍCIO DO EDITAL ---
${input.fullText}
--- FIM DO EDITAL ---

Responda apenas com o JSON.`;
}

/** Prompt do usuário para a leitura de um bloco. */
export function buildMapUserPrompt(input: {
  fileName: string;
  chunk: DocumentChunk;
  totalChunks: number;
}): string {
  return `ARQUIVO: ${input.fileName}
BLOCO ${input.chunk.index + 1} DE ${input.totalChunks} — ${input.chunk.label} (páginas ${input.chunk.pages.join(', ')})

${MAP_INSTRUCTIONS}

--- INÍCIO DO TRECHO ---
${input.chunk.text}
--- FIM DO TRECHO ---

Responda apenas com o JSON.`;
}

/**
 * Recorta uma extração parcial para caber no orçamento de contexto.
 *
 * O recorte é ESTRUTURAL: percorre as chaves, encurta listas e textos, e sempre
 * devolve JSON válido. Cortar a string serializada no meio entregaria JSON
 * inválido ao modelo e degradaria a síntese.
 */
function clipJson(value: unknown, maxChars: number): string {
  const fitted = fitToBudget(value, maxChars);
  return JSON.stringify(fitted);
}

/** Reduz progressivamente um valor até a serialização caber no orçamento. */
function fitToBudget(value: unknown, maxChars: number): unknown {
  if (JSON.stringify(value) === undefined) return null;
  if (JSON.stringify(value).length <= maxChars) return value;

  if (Array.isArray(value)) {
    // Mantém o maior prefixo possível da lista e registra quantos itens ficaram fora.
    const kept: unknown[] = [];
    let size = 2;
    for (const item of value) {
      const itemSize = JSON.stringify(item)?.length ?? 0;
      if (size + itemSize + 1 > maxChars - 60) break;
      kept.push(item);
      size += itemSize + 1;
    }
    const restantes = value.length - kept.length;
    return restantes > 0
      ? { itensConsiderados: kept.length, totalDeItens: value.length, itens: kept }
      : kept;
  }

  if (value && typeof value === 'object') {
    // Primeiro tenta manter todas as chaves reduzindo cada uma proporcionalmente.
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const perKey = Math.max(180, Math.floor(maxChars / Math.max(1, keys.length)));
    const reduced: Record<string, unknown> = {};
    for (const key of keys) {
      const item = record[key];
      const serialized = JSON.stringify(item) ?? 'null';
      reduced[key] = serialized.length <= perKey ? item : fitToBudget(item, perKey);
    }
    if (JSON.stringify(reduced).length <= maxChars) return reduced;

    // Se ainda não couber, mantém as chaves na ordem até estourar o orçamento.
    const trimmed: Record<string, unknown> = {};
    let size = 2;
    for (const key of keys) {
      const entry = JSON.stringify({ [key]: reduced[key] })?.length ?? 0;
      if (size + entry > maxChars - 40) break;
      trimmed[key] = reduced[key];
      size += entry;
    }
    trimmed.recorte = 'conteúdo parcial: orçamento de contexto atingido';
    return trimmed;
  }

  if (typeof value === 'string') {
    return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 20))}…`;
  }

  return value;
}

/**
 * Orçamento de caracteres para cada extração parcial na síntese final.
 *
 * Sem esse cálculo, um edital muito grande (ex.: 40 blocos) produziria um
 * prompt maior que a janela de contexto do modelo — o provedor devolveria erro
 * e a análise já paga em todas as chamadas de bloco seria perdida.
 */
export function computeReduceBudget(input: {
  partials: number;
  pageIndexChars: number;
  fixedChars: number;
  contextTokens: number;
  budgetRatio: number;
}): { perPartialChars: number; indexChars: number; estimatedTokens: number; fits: boolean } {
  const budgetChars = Math.floor(input.contextTokens * input.budgetRatio * 3.4);
  const disponivel = Math.max(4_000, budgetChars - input.fixedChars - input.pageIndexChars);
  const perPartialChars = Math.max(700, Math.floor(disponivel / Math.max(1, input.partials)));
  const indexChars = input.pageIndexChars;
  const estimatedTokens = Math.ceil((input.fixedChars + indexChars + perPartialChars * input.partials) / 3.4);

  return {
    perPartialChars,
    indexChars,
    estimatedTokens,
    fits: estimatedTokens <= input.contextTokens * input.budgetRatio,
  };
}

/** Prompt do usuário para a síntese final. */
export function buildReduceUserPrompt(input: {
  fileName: string;
  pages: number;
  totalChars: number;
  chunkCount: number;
  pageIndex: PageIndexEntry[];
  partials: Array<{ label: string; pages: number[]; data: unknown }>;
  /** Limite de caracteres por extração parcial, para controlar o contexto. */
  perPartialChars?: number;
  /**
   * Orçamento de contexto calculado pelo orquestrador (`computeReduceBudget`).
   * Quando informado, tem precedência sobre `perPartialChars`.
   */
  budget?: { perPartialChars: number; indexChars: number };
}): string {
  const perPartial = input.budget?.perPartialChars ?? input.perPartialChars ?? 9_000;
  const indexLimit = input.budget?.indexChars;

  // O índice de páginas pode ser reduzido (ou omitido) quando o documento é
  // grande: as extrações parciais são mais valiosas que a prévia de cada página.
  const indexEntries = indexLimit
    ? input.pageIndex.map((entry) => ({
        ...entry,
        preview: entry.preview.slice(0, Math.max(40, Math.floor(indexLimit / Math.max(1, input.pageIndex.length)))),
      }))
    : input.pageIndex;

  const indexText = indexEntries
    .map((entry) => `p.${entry.page} (${entry.chars} car.): ${entry.preview}`)
    .join('\n');

  const partialsText = input.partials
    .map(
      (partial, position) =>
        `### BLOCO ${position + 1} — ${partial.label} (páginas ${partial.pages.join(', ')})\n${clipJson(partial.data, perPartial)}`,
    )
    .join('\n\n');

  return `Consolide a análise do edital abaixo.

ARQUIVO: ${input.fileName}
DATA DE HOJE: ${hojeBrasilia()} (horário de Brasília). Use-a para dizer quantos dias faltam para cada prazo e se ele já passou.
PÁGINAS: ${input.pages} · CARACTERES: ${input.totalChars} · BLOCOS ANALISADOS: ${input.chunkCount}

## ÍNDICE DE PÁGINAS (início de cada página)
${indexText}

## EXTRAÇÕES PARCIAIS POR BLOCO
${partialsText}

${REDUCE_INSTRUCTIONS}

${FINAL_SCHEMA_INSTRUCTIONS}

Responda apenas com o JSON.`;
}
