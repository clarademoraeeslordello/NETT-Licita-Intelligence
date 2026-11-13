/**
 * Orquestrador do pipeline de análise.
 *
 *   recebido → extração (PDF) → análise → estruturação (schema) → relatório
 *
 * Documentos curtos: uma única chamada ao modelo.
 * Documentos longos: mapa (por blocos de páginas) + redução (síntese final),
 * nunca corte arbitrário de texto.
 */
import { config, hasAIProvider } from './config';
import { buildChunks, buildPageIndex, estimateTokens, isDocumentLong } from './chunking';
import { createJsonCompletion, estimateCostUSD } from './ai/client';
import { parseModelJson } from './ai/json';
import {
  buildDirectUserPrompt,
  buildMapUserPrompt,
  buildReduceUserPrompt,
  computeReduceBudget,
  FINAL_SCHEMA_INSTRUCTIONS,
  REDUCE_INSTRUCTIONS,
  SYSTEM_PROMPT,
} from './ai/prompts';
import { completarComExtratorLocal, completarSecoesFinais, normalizeAnalysis } from './ai/normalize';
import { analyzeLocally } from './ai/local';
import { isAppError, toPublicError } from './errors';
import { assertHasTextLayer, extractDocument } from './pdf/extract';
import type { AnalysisResult } from './schema';
import { getJob, unlinkHash, updateJob, type JobStage } from './store';
import { salvarJob } from './persistencia';

export type ProgressReporter = (event: {
  stage: JobStage;
  progress: number;
  message: string;
  detail?: string;
  meta?: Record<string, number | string>;
}) => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Executa tarefas assíncronas respeitando um limite de concorrência. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

export type AnalyzeOptions = {
  fileName: string;
  fileSize: number;
  isDemo?: boolean;
  /** Rótulo curto do arquivo, usado nos prompts. */
  hash?: string;
};

/**
 * Executa o pipeline completo de análise.
 * @param buffer conteúdo do PDF
 * @param jobId id do job usado para reportar progresso
 */
export async function runAnalysis(
  buffer: Buffer,
  jobId: string,
  options: AnalyzeOptions,
): Promise<AnalysisResult> {
  const startedAt = Date.now();
  const report: ProgressReporter = (event) => {
    updateJob(jobId, {
      stage: event.stage,
      progress: event.progress,
      message: event.message,
      detail: event.detail,
      meta: event.meta as never,
    });
  };

  const dataAnalise = new Date().toISOString();
  const avisos: string[] = [];

  /* ----------------------- 1. Extração do PDF ----------------------- */
  report({
    stage: 'extracting',
    progress: 8,
    message: 'Extraindo conteúdo do PDF',
    detail: 'Lendo páginas e preservando a estrutura do documento...',
  });

  // Erros de extração viram AppError com código, mensagem e dica acionável.
  const document = await extractDocument(buffer);
  assertHasTextLayer(document);

  report({
    stage: 'extracting',
    progress: 22,
    message: 'Conteúdo extraído',
    detail: `${document.totalPages} página(s) · ${document.totalChars.toLocaleString('pt-BR')} caracteres · ~${document.words.toLocaleString('pt-BR')} palavras`,
    meta: { pages: document.totalPages, chars: document.totalChars, words: document.words },
  });

  const useAI = hasAIProvider();

  /* ---------------- 2. Motor local (sem IA ou IA indisponível) ------------- */
  const motorLocal = async (detail: string, falhaIa?: string): Promise<AnalysisResult> => {
    report({
      stage: 'analyzing',
      progress: 42,
      message: 'Aplicando motor local de extração',
      detail,
    });
    await sleep(500);

    const analise = analyzeLocally(document, { fileName: options.fileName, dataAnalise });

    report({
      stage: 'structuring',
      progress: 74,
      message: 'Estruturando informações',
      detail: 'Aplicando validação de schema e normalizando evidências.',
    });
    await sleep(350);

    report({
      stage: 'reporting',
      progress: 92,
      message: 'Gerando relatório',
      detail: 'Consolidando resumo executivo, cronograma e checklist.',
    });
    await sleep(300);

    const result: AnalysisResult = {
      analise,
      meta: {
        engine: 'local-demo',
        ...(falhaIa ? { falhaIa } : {}),
        chunks: 1,
        llmCalls: 0,
        tokensEstimados: estimateTokens(document.fullText),
        duracaoMs: Date.now() - startedAt,
        avisos,
        custoEstimadoUSD: 0,
      },
    };

    // Motor local no lugar da IA que falhou: não entra no cache, senão o mesmo PDF
    // continuaria recebendo a versão simplificada mesmo com a IA de volta.
    if (falhaIa && options.hash) unlinkHash(options.hash);
    await completeJob(jobId, result, 'Relatório pronto para visualização.', falhaIa ? undefined : options.hash);
    return result;
  };

  if (!useAI) return motorLocal('Nenhuma chave de IA configurada — usando o analisador determinístico embutido.');

  const prazoIa = startedAt + config.ai.totalBudgetMs;

  try {
    /* -------------------- 3. Análise com IA (LLM) --------------------- */
    const chunks = buildChunks(document);
    const long = isDocumentLong(document);

    // Se o documento excedeu MAX_CHUNKS, o excedente foi descartado: isso precisa
    // aparecer de forma explícita, porque o relatório não representaria o edital
    // por inteiro.
    const truncation = chunks.find((chunk) => chunk.truncated)?.truncated;
    if (truncation) {
      avisos.push(
        `ATENÇÃO: o documento excedeu o limite de ${config.chunking.maxChunks} blocos e ${truncation.paginasDescartadas.length} página(s) (a partir da página ${Math.min(...truncation.paginasDescartadas)}) NÃO foram analisadas. Aumente MAX_CHUNKS no .env para ler o documento integralmente.`,
      );
    }

    avisos.push(
      long
        ? `Documento extenso (${document.totalChars.toLocaleString('pt-BR')} caracteres): análise em ${chunks.length} blocos de páginas + síntese final.`
        : 'Documento dentro do limite de uma única chamada: análise direta, sem fragmentação.',
    );

    let promptTokens = 0;
    let completionTokens = 0;
    let llmCalls = 0;
    let modelUsed = config.ai.model;

    const track = (usage?: { promptTokens: number; completionTokens: number }) => {
      if (!usage) return;
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
    };

    let rawAnalysis: unknown;

    if (!long) {
      report({
        stage: 'analyzing',
        progress: 40,
        message: 'Analisando edital com IA',
        detail: `Modelo ${config.ai.model} · documento completo em uma única leitura`,
      });
      const completion = await createJsonCompletion({
        prazo: prazoIa,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildDirectUserPrompt({
              fileName: options.fileName,
              pages: document.totalPages,
              fullText: document.fullText,
            }),
          },
        ],
        label: 'análise direta',
      });
      llmCalls += 1;
      modelUsed = completion.model;
      track(completion.usage);

      const parsed = parseModelJson(completion.content, {
        truncated: completion.truncated,
        label: 'análise direta',
      });
      if (parsed.repaired) {
        avisos.push(
          'A resposta do modelo foi cortada no limite de tokens de saída e recuperada parcialmente. As últimas seções do relatório (ex.: valores, pontos de atenção e checklist) podem estar incompletas — confira o edital original.',
        );
      }
      rawAnalysis = parsed.data;
    } else {
      report({
        stage: 'analyzing',
        progress: 32,
        message: `Analisando edital em ${chunks.length} blocos`,
        detail: 'Leitura sequencial por páginas, preservando a referência de origem.',
      });

      let completed = 0;
      const prazoFinal = config.ai.maxAnalysisMs > 0 ? startedAt + config.ai.maxAnalysisMs : Number.POSITIVE_INFINITY;

      const partials = await mapWithConcurrency(chunks, config.chunking.concurrency, async (chunk) => {
        // Teto de tempo global: interrompe antes de acumular horas de tentativas.
        if (Date.now() > prazoFinal) {
          avisos.push(
            `O limite de tempo da análise (${Math.round(config.ai.maxAnalysisMs / 60000)} min) foi atingido antes do bloco ${chunk.label}. Aumente AI_MAX_ANALYSIS_MS ou reduza o documento.`,
          );
          return { label: chunk.label, pages: chunk.pages, data: { erro: 'bloco não processado (tempo esgotado)' } };
        }

        try {
          const completion = await createJsonCompletion({
            prazo: prazoIa,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: buildMapUserPrompt({
                  fileName: options.fileName,
                  chunk,
                  totalChunks: chunks.length,
                }),
              },
            ],
            label: `bloco ${chunk.index + 1}`,
          });
          llmCalls += 1;
          modelUsed = completion.model;
          track(completion.usage);

          let data: unknown;
          try {
            const parsed = parseModelJson(completion.content, {
              truncated: completion.truncated,
              label: `bloco ${chunk.index + 1}`,
            });
            data = parsed.data;
            if (parsed.repaired) {
              avisos.push(
                `O bloco ${chunk.label} foi cortado no limite de tokens de saída e recuperado parcialmente.`,
              );
            }
          } catch {
            data = { erro: 'bloco não pôde ser interpretado', label: chunk.label };
            avisos.push(`O bloco ${chunk.label} não retornou JSON válido e foi ignorado na síntese.`);
          }
          return { label: chunk.label, pages: chunk.pages, data };
        } catch (error) {
          // Degradação graciosa: um bloco com falha (rate limit persistente, erro
          // do provedor) não pode descartar os outros 39 já extraídos e pagos.
          const mensagem = error instanceof Error ? error.message : String(error);
          avisos.push(
            `O bloco ${chunk.label} falhou após as tentativas automáticas (${mensagem.slice(0, 120)}). O conteúdo dessas páginas não entrou na síntese e deve ser conferido manualmente.`,
          );
          return { label: chunk.label, pages: chunk.pages, data: { erro: 'falha ao processar o bloco' } };
        } finally {
          completed += 1;
          report({
            stage: 'analyzing',
            progress: 32 + (completed / chunks.length) * 38,
            message: `Bloco ${completed} de ${chunks.length} processado`,
            detail: `${chunk.label} · ${chunk.chars.toLocaleString('pt-BR')} caracteres`,
          });
        }
      });

      report({
        stage: 'structuring',
        progress: 74,
        message: 'Consolidando blocos (síntese final)',
        detail: 'Unificando dados repetidos, resolvendo conflitos e montando o documento final.',
      });

      const index = buildPageIndex(document);
      const fixedChars = FINAL_SCHEMA_INSTRUCTIONS.length + REDUCE_INSTRUCTIONS.length + 1_200;
      const budget = computeReduceBudget({
        partials: partials.length,
        pageIndexChars: index.reduce((acc, entry) => acc + entry.preview.length + 24, 0),
        fixedChars,
        contextTokens: config.ai.contextWindowTokens,
        budgetRatio: config.ai.promptBudgetRatio,
      });
      if (!budget.fits) {
        avisos.push(
          `A síntese final precisou comprimir as extrações parciais para caber na janela de contexto do modelo (${config.ai.contextWindowTokens.toLocaleString('pt-BR')} tokens). Revise o relatório com atenção redobrada.`,
        );
      }

      const reduceCompletion = await createJsonCompletion({
        prazo: prazoIa,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildReduceUserPrompt({
              fileName: options.fileName,
              pages: document.totalPages,
              totalChars: document.totalChars,
              chunkCount: chunks.length,
              pageIndex: index,
              partials,
              budget,
            }),
          },
        ],
        model: config.ai.synthesisModel,
        label: 'síntese final',
      });
      llmCalls += 1;
      modelUsed = reduceCompletion.model;
      track(reduceCompletion.usage);

      const parsedReduce = parseModelJson(reduceCompletion.content, {
        truncated: reduceCompletion.truncated,
        label: 'síntese final',
      });
      if (parsedReduce.repaired) {
        avisos.push(
          'A síntese final foi cortada no limite de tokens de saída e recuperada parcialmente. As últimas seções do relatório podem estar incompletas — confira o edital original.',
        );
      }
      rawAnalysis = parsedReduce.data;
    }

    /* ---------------- 4. Estruturação e validação --------------------- */
    report({
      stage: 'structuring',
      progress: 88,
      message: 'Validando estrutura da análise',
      detail: 'Aplicando schema estrito e normalizando evidências rastreáveis.',
    });

    const daIa = normalizeAnalysis(rawAnalysis, {
      dataAnalise,
      paginas: document.totalPages,
      caracteres: document.totalChars,
    });
    const completadas = completarComExtratorLocal(
      daIa,
      analyzeLocally(document, { fileName: options.fileName, dataAnalise }),
    );
    if (completadas.length > 0) {
      avisos.push(
        `A IA não preencheu ${completadas.join(', ')}; essas seções foram completadas pelo extrator automático, com a página de origem de cada item.`,
      );
    }
    const analise = completarSecoesFinais(daIa);

    const totalEvidencias = countEvidence(analise);
    if (totalEvidencias < 6) {
      avisos.push(
        'Poucas informações rastreáveis foram encontradas. O documento pode ser um extrato, um aviso de licitação ou ter texto parcialmente ilegível.',
      );
    }

    /* --------------------- 5. Relatório / retorno --------------------- */
    report({
      stage: 'reporting',
      progress: 95,
      message: 'Gerando relatório',
      detail: 'Consolidando resumo executivo, cronograma, obrigações e checklist.',
    });

    const result: AnalysisResult = {
      analise,
      meta: {
        engine: 'deepseek',
        model: modelUsed,
        chunks: chunks.length,
        llmCalls,
        tokensEstimados: promptTokens + completionTokens,
        duracaoMs: Date.now() - startedAt,
        avisos,
        custoEstimadoUSD: estimateCostUSD(promptTokens, completionTokens),
      },
    };

    await completeJob(
      jobId,
      result,
      `${llmCalls} chamada(s) ao modelo · ${(promptTokens + completionTokens).toLocaleString('pt-BR')} tokens`,
      options.hash,
    );

    return result;
  } catch (error) {
    // Na demo pública a IA é gratuita e pode estar sobrecarregada: em vez de falhar,
    // entrega o relatório do motor local e avisa que a leitura foi simplificada.
    if (!isAppError(error) || !['AI_FAILED', 'AI_INVALID_RESPONSE', 'ANALYSIS_TIMEOUT'].includes(error.code)) throw error;
    avisos.length = 0;
    avisos.push('A IA não respondeu a tempo. Este relatório foi gerado pelo motor local, mais simples, e não gastou sua cota. Envie o edital de novo em alguns minutos para a análise completa com IA.');
    const falha = `${error.code}: ${error.message}${error.details ? ` — ${error.details}` : ''}`.slice(0, 500);
    console.error('[editais] IA falhou, motor local assumiu:', falha);
    return motorLocal('IA indisponível agora — usando o analisador determinístico embutido.', falha);
  }
}

/** Conta quantas informações rastreáveis a análise efetivamente trouxe. */
export function countEvidence(analise: {
  informacoesGerais: Record<string, { status?: string } | undefined>;
  cronograma: unknown[];
  pontosDeAtencao: unknown[];
  checklist: unknown[];
  participacao: Record<string, unknown>;
  obrigacoes: Record<string, unknown>;
}): number {
  let total = 0;
  for (const value of Object.values(analise.informacoesGerais)) {
    if (value && typeof value === 'object' && value.status === 'found') total += 1;
  }
  total += analise.cronograma.length;
  total += analise.pontosDeAtencao.length;
  total += analise.checklist.length;
  for (const value of Object.values(analise.participacao)) {
    if (Array.isArray(value)) total += value.length;
  }
  for (const value of Object.values(analise.obrigacoes)) {
    if (Array.isArray(value)) total += value.length;
  }
  return total;
}

/**
 * Grava o resultado no job e sinaliza a conclusão.
 *
 * É esta gravação que faz o stream SSE emitir `done` e a rota
 * `/api/jobs/[id]/analysis` servir o relatório; sem ela o pipeline termina em
 * silêncio e a interface espera até o watchdog desistir.
 */
export async function completeJob(jobId: string, result: AnalysisResult, detail: string, hash?: string): Promise<void> {
  // Grava ANTES de anunciar "pronto": a interface redireciona para o relatório
  // assim que recebe o evento, e essa página pode abrir em outra instância.
  const job = getJob(jobId);
  if (job) {
    const agora = Date.now();
    await salvarJob(
      {
        ...job,
        stage: 'done',
        progress: 100,
        result,
        updatedAt: agora,
        steps: job.steps.map((step) => ({ ...step, status: 'done' as const })),
        events: [...job.events, { stage: 'done', progress: 100, message: 'Análise concluída', detail, at: agora }],
      },
      hash,
    );
  }
  updateJob(jobId, {
    stage: 'done',
    progress: 100,
    message: 'Análise concluída',
    detail,
    result,
  });
}

/** Marca o job como falho de forma consistente. */
export function failJob(jobId: string, error: unknown): void {
  const publicError = toPublicError(error);
  updateJob(jobId, {
    stage: 'error',
    progress: 100,
    message: publicError.message,
    detail: publicError.details,
    error: publicError,
  });
}
