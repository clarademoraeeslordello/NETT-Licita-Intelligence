/**
 * Cliente HTTP para APIs de chat completion compatíveis com OpenAI.
 * Por padrão aponta para a API do DeepSeek.
 *
 * Só é executado no servidor: a chave nunca chega ao browser.
 */
import { config } from '../config';
import { AppError, ERROR_MESSAGES } from '../errors';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type CompletionResult = {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  latencyMs: number;
  /** Motivo de parada informado pelo provedor (`stop`, `length`, ...). */
  finishReason?: string;
  /** `true` quando a resposta foi cortada pelo limite de tokens de saída. */
  truncated: boolean;
};

type RawCompletion = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
  error?: { message?: string; type?: string };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Erros que valem uma nova tentativa. */
function isRetryable(status: number, message: string): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  return /timeout|temporar|overload|rate limit|ECONNRESET|socket hang up/i.test(message);
}

/**
 * Próximo orçamento de saída quando o modelo foi cortado por `finish_reason=length`.
 *
 * Um schema de análise completo não cabe em 8K tokens para editais de tamanho
 * médio: sem essa elevação, a resposta volta truncada e o JSON não fecha.
 * O teto considera a janela de contexto do modelo — não adianta pedir mais
 * saída do que o espaço que sobra depois do prompt.
 */
export function nextOutputBudget(input: {
  current: number;
  ceiling: number;
  contextWindow?: number;
  promptTokens?: number;
}): number {
  const stepped = Math.max(input.current * 2, input.current + 4_096);
  let next = Math.min(stepped, input.ceiling);

  if (input.contextWindow && input.promptTokens) {
    // Folga de 1K tokens para o envelope da conversa.
    next = Math.min(next, input.contextWindow - input.promptTokens - 1_024);
  }

  // Nunca reduzir o orçamento atual: se não há espaço para crescer, o chamador
  // degrada com o reparo de JSON em vez de repetir a mesma chamada.
  return Math.max(input.current, next);
}

/**
 * Executa uma chamada de chat completion pedindo resposta em JSON.
 * Faz retry com backoff exponencial em falhas transitórias e, quando o provedor
 * corta a resposta por limite de tokens (`finish_reason=length`), repete a mesma
 * chamada com um orçamento de saída maior antes de devolver o conteúdo truncado.
 */
export async function createJsonCompletion(options: {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Rótulo usado em logs e mensagens de erro. */
  label?: string;
  /** Instante (epoch ms) a partir do qual não se tenta mais: protege o limite de execução do servidor. */
  prazo?: number;
}): Promise<CompletionResult> {
  const apiKey = config.ai.apiKey;
  if (!apiKey) {
    throw new AppError('AI_NOT_CONFIGURED', ERROR_MESSAGES.AI_NOT_CONFIGURED, {
      status: 503,
      hint: 'Defina GEMINI_API_KEY (gratuita) ou DEEPSEEK_API_KEY no arquivo .env para habilitar a análise por IA.',
    });
  }

  const principal = options.model ?? config.ai.model;
  const cadeia = [principal, ...config.ai.fallbackModels.filter((m) => m !== principal)];
  let indiceModelo = 0;
  let model = principal;
  const url = `${config.ai.baseUrl}/chat/completions`;
  const ceiling = Math.max(options.maxTokens ?? config.ai.maxOutputTokens, config.ai.maxOutputTokensCeiling);
  let budget = options.maxTokens ?? config.ai.maxOutputTokens;

  let lastError: unknown;
  let errorRetries = 0;
  let escalations = 0;
  /** Tokens das tentativas truncadas: a análise foi paga e precisa aparecer no custo. */
  const wasted = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (;;) {
    const restante = options.prazo ? options.prazo - Date.now() : Number.POSITIVE_INFINITY;
    if (restante < 5_000) {
      throw new AppError('ANALYSIS_TIMEOUT', ERROR_MESSAGES.ANALYSIS_TIMEOUT, {
        status: 504,
        details: `Prazo total da IA esgotado em "${options.label ?? model}".`,
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.ai.timeoutMs, restante));
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: options.messages,
          temperature: options.temperature ?? config.ai.temperature,
          max_tokens: budget,
          response_format: { type: 'json_object' },
          ...(config.ai.reasoningEffort ? { reasoning_effort: config.ai.reasoningEffort } : {}),
          stream: false,
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const bodyText = await response.text();

      if (!response.ok) {
        let apiMessage = bodyText.slice(0, 500);
        try {
          apiMessage = (JSON.parse(bodyText) as RawCompletion).error?.message ?? apiMessage;
        } catch {
          /* mantém o corpo bruto */
        }
        const detail = `HTTP ${response.status} · ${apiMessage}`;
        // Modelo sobrecarregado ou sem cota: passa para o próximo da cadeia antes de esperar.
        if ((response.status === 503 || response.status === 429) && indiceModelo < cadeia.length - 1) {
          indiceModelo += 1;
          model = cadeia[indiceModelo];
          console.warn(`[editais] ${detail}. Tentando o modelo ${model}.`);
          lastError = new AppError('AI_FAILED', ERROR_MESSAGES.AI_FAILED, { status: 502, details: detail });
          continue;
        }
        if (errorRetries < config.ai.maxRetries && isRetryable(response.status, apiMessage)) {
          errorRetries += 1;
          await sleep(1200 * 2 ** (errorRetries - 1));
          lastError = new AppError('AI_FAILED', ERROR_MESSAGES.AI_FAILED, {
            status: 502,
            details: detail,
          });
          continue;
        }
        throw new AppError(
          response.status === 401 || response.status === 403 ? 'AI_NOT_CONFIGURED' : 'AI_FAILED',
          response.status === 401 || response.status === 403
            ? 'A chave da API de IA foi recusada pelo provedor.'
            : ERROR_MESSAGES.AI_FAILED,
          {
            status: 502,
            details: detail,
            hint:
              response.status === 401 || response.status === 403
                ? 'Confira GEMINI_API_KEY (ou DEEPSEEK_API_KEY) no arquivo .env.'
                : 'O provedor de IA está instável ou indisponível. Tente novamente em instantes.',
          },
        );
      }

      let parsed: RawCompletion;
      try {
        parsed = JSON.parse(bodyText) as RawCompletion;
      } catch {
        throw new AppError('AI_INVALID_RESPONSE', ERROR_MESSAGES.AI_INVALID_RESPONSE, {
          status: 502,
          details: 'O provedor retornou um corpo que não é JSON.',
        });
      }

      const content = parsed.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        throw new AppError('AI_INVALID_RESPONSE', ERROR_MESSAGES.AI_INVALID_RESPONSE, {
          status: 502,
          details: `Resposta vazia em "${options.label ?? model}".`,
        });
      }

      const usage = parsed.usage;
      const finishReason = parsed.choices?.[0]?.finish_reason;
      const truncated = finishReason === 'length';

      // O provedor aceita orçamentos de saída bem maiores que o padrão: quando o
      // corte acontece, repetir a chamada com mais espaço é mais barato (e mais
      // fiel ao edital) do que entregar uma análise pela metade.
      if (truncated && escalations < config.ai.maxOutputTokenEscalations) {
        const next = nextOutputBudget({
          current: budget,
          ceiling,
          contextWindow: config.ai.contextWindowTokens,
          promptTokens: usage?.prompt_tokens,
        });
        if (next > budget) {
          escalations += 1;
          console.warn(
            `[editais] resposta truncada em "${options.label ?? model}" (${usage?.completion_tokens ?? '?'} tokens de saída). Repetindo com max_tokens=${next}.`,
          );
          if (usage) {
            wasted.promptTokens += usage.prompt_tokens ?? 0;
            wasted.completionTokens += usage.completion_tokens ?? 0;
            wasted.totalTokens += usage.total_tokens ?? 0;
          }
          budget = next;
          continue;
        }
      }

      return {
        content,
        model: parsed.model ?? model,
        latencyMs,
        finishReason,
        truncated,
        usage: usage
          ? {
              promptTokens: (usage.prompt_tokens ?? 0) + wasted.promptTokens,
              completionTokens: (usage.completion_tokens ?? 0) + wasted.completionTokens,
              totalTokens: (usage.total_tokens ?? 0) + wasted.totalTokens,
            }
          : wasted.totalTokens > 0
            ? { ...wasted }
            : undefined,
      };
    } catch (error) {
      lastError = error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (aborted) {
        const prazoEsgotado = options.prazo !== undefined && Date.now() >= options.prazo - 5_000;
        if (!prazoEsgotado && errorRetries < config.ai.maxRetries) {
          errorRetries += 1;
          await sleep(1000 * 2 ** (errorRetries - 1));
          continue;
        }
        throw new AppError('ANALYSIS_TIMEOUT', ERROR_MESSAGES.ANALYSIS_TIMEOUT, {
          status: 504,
          hint: `O provedor de IA não respondeu em ${Math.round(config.ai.timeoutMs / 1000)}s. Tente novamente.`,
        });
      }
      if (error instanceof AppError) throw error;
      if (errorRetries < config.ai.maxRetries) {
        errorRetries += 1;
        await sleep(1200 * 2 ** (errorRetries - 1));
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new AppError('AI_FAILED', ERROR_MESSAGES.AI_FAILED, {
    status: 502,
    details: lastError instanceof Error ? lastError.message : String(lastError),
    hint: 'Verifique a conectividade do servidor com o provedor de IA.',
  });
}

/** Custo aproximado da chamada em USD, para exibição no rodapé técnico. */
export function estimateCostUSD(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * config.ai.priceInputPerM +
    (completionTokens / 1_000_000) * config.ai.priceOutputPerM
  );
}
