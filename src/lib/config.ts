/**
 * Configuração central da aplicação.
 * Nada aqui é exposto ao browser: todos os valores são lidos no servidor.
 */

const env = process.env;

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return /^(1|true|sim|yes|on)$/i.test(value.trim());
}

/** Inteiro não negativo (aceita `0`), diferente de `num`, que exige valor > 0. */
function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

/**
 * Provedor de IA. Todos falam o formato da API OpenAI; muda só endereço, chave e modelo.
 * DeepSeek (pago, barato, janela de 1M de tokens) tem prioridade porque responde rápido
 * e com qualidade constante. Gemini (camada gratuita) fica como alternativa sem custo,
 * mas sofre com sobrecarga nos horários de pico.
 */
const deepseek = {
  nome: 'deepseek' as const,
  apiKey: env.DEEPSEEK_API_KEY?.trim() ?? '',
  baseUrl: (env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/+$/, ''),
  model: env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash',
  reservas: [] as string[],
  contexto: 1_000_000,
  precoEntrada: 0.27,
  precoSaida: 1.1,
};

const gemini = {
  nome: 'gemini' as const,
  apiKey: env.GEMINI_API_KEY?.trim() ?? '',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash',
  /** Modelos tentados, em ordem, quando o principal está sobrecarregado (503/429). */
  reservas: (env.GEMINI_MODELOS_RESERVA?.trim() || 'gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean),
  contexto: 1_000_000,
  precoEntrada: 0,
  precoSaida: 0,
};

const provedor = deepseek.apiKey ? deepseek : gemini;

export const config = {
  /** Provedor de IA (compatível com a API OpenAI). */
  ai: {
    provider: provedor.nome,
    apiKey: provedor.apiKey,
    baseUrl: provedor.baseUrl,
    model: provedor.model,
    fallbackModels: provedor.reservas,
    /**
     * Nível de raciocínio (`reasoning_effort`) para modelos que o aceitam. Na DeepSeek
     * V4 o padrão do provedor é "high", que pode passar de 3 min por edital; "low"
     * mantém a extração fiel e responde bem mais rápido.
     */
    reasoningEffort: env.AI_ESFORCO?.trim() || (provedor.nome === 'deepseek' ? 'low' : ''),
    /** Modelo usado na etapa de síntese final (documentos longos). */
    synthesisModel: env.DEEPSEEK_SYNTHESIS_MODEL?.trim() || provedor.model,
    timeoutMs: num(env.AI_TIMEOUT_MS, 180_000),
    maxRetries: num(env.AI_MAX_RETRIES, 2),
    /**
     * Tempo total que a IA tem para concluir uma análise. Acima disso o relatório
     * sai pelo motor local. Fica abaixo do limite de 300 s da função na Vercel.
     */
    totalBudgetMs: num(env.AI_ORCAMENTO_TOTAL_MS, 250_000),
    temperature: Number.isFinite(Number(env.AI_TEMPERATURE)) ? Number(env.AI_TEMPERATURE) : 0,
    /**
     * Orçamento de saída das respostas do modelo. O schema completo de uma
     * análise (dez seções com trechos de origem) costuma exigir de 12K a 15K
     * tokens em um edital de 8 páginas — bem acima dos 8K que eram o padrão
     * anterior, que devolvia a resposta cortada.
     */
    maxOutputTokens: num(env.AI_MAX_OUTPUT_TOKENS, 32_768),
    /**
     * Teto para o qual o orçamento de saída pode subir quando o provedor corta a
     * resposta (`finish_reason=length`). O schema completo de um edital médio não
     * cabe em 8K tokens: sem essa elevação, a resposta volta truncada e o JSON
     * não fecha.
     */
    maxOutputTokensCeiling: num(env.AI_MAX_OUTPUT_TOKENS_CEILING, 65_536),
    /** Quantas vezes repetir a chamada com orçamento maior antes de degradar. */
    maxOutputTokenEscalations: int(env.AI_MAX_OUTPUT_ESCALATIONS, 1),
    /**
     * Janela de contexto do modelo (tokens). Usada para dimensionar o prompt da
     * síntese final em documentos longos: sem esse orçamento, um edital muito
     * grande poderia estourar o contexto e derrubar uma análise já paga.
     */
    contextWindowTokens: num(env.AI_CONTEXT_WINDOW_TOKENS, provedor.contexto),
    /** Fração da janela reservada para o prompt (o resto é saída + folga). */
    promptBudgetRatio: Number(env.AI_PROMPT_BUDGET_RATIO) > 0 ? Number(env.AI_PROMPT_BUDGET_RATIO) : 0.7,
    /**
     * Teto de tempo para a análise completa (ms). Impede que uma sequência de
     * blocos com timeout se prolongue por horas queimando tokens sem entregar
     * resultado. 0 desativa.
     */
    maxAnalysisMs: Number(env.AI_MAX_ANALYSIS_MS) >= 0 ? Number(env.AI_MAX_ANALYSIS_MS) : 15 * 60 * 1000,
    /** Preços de referência (USD por 1M tokens) — usados só para estimativa. */
    priceInputPerM: Number(env.AI_PRICE_INPUT_PER_M ?? provedor.precoEntrada),
    priceOutputPerM: Number(env.AI_PRICE_OUTPUT_PER_M ?? provedor.precoSaida),
  },

  /** Limites de upload e de processamento do PDF. */
  upload: {
    maxBytes: num(env.MAX_UPLOAD_MB, 25) * 1024 * 1024,
    maxPages: num(env.MAX_PDF_PAGES, 600),
    /** Abaixo disso o texto é considerado insuficiente (PDF escaneado). */
    minCharsForAnalysis: num(env.MIN_CHARS_FOR_ANALYSIS, 400),
  },

  /** Estratégia de divisão do documento para editais longos. */
  chunking: {
    /** Até este tamanho o edital é analisado em uma única chamada. */
    singleCallMaxChars: num(env.SINGLE_CALL_MAX_CHARS, 400_000),
    /** Tamanho alvo de cada bloco no modo mapa-redução. */
    chunkChars: num(env.CHUNK_CHARS, 14_000),
    /** Sobreposição entre blocos para não perder contexto nas fronteiras. */
    overlapChars: num(env.CHUNK_OVERLAP_CHARS, 800),
    maxChunks: num(env.MAX_CHUNKS, 80),
    concurrency: num(env.CHUNK_CONCURRENCY, 3),
    /** Recorte da página usado no índice enviado na síntese. */
    indexPreviewChars: num(env.PAGE_INDEX_PREVIEW_CHARS, 110),
  },

  /** Geração do relatório em PDF. */
  report: {
    /** Navegador headless usado no print-to-pdf (Edge/Chrome). */
    browserPath: env.REPORT_BROWSER_PATH?.trim() || '',
    timeoutMs: num(env.REPORT_TIMEOUT_MS, 90_000),
    disabled: bool(env.REPORT_PDF_DISABLED, false),
    version: '1.0',
  },

  app: {
    name: 'Analisador Inteligente de Editais',
    shortName: 'Analisador de Editais',
    tagline: 'Leia um edital inteiro em minutos, não em horas.',
    disclaimer:
      'Esta análise é um apoio à decisão gerado automaticamente por inteligência artificial. Não constitui parecer jurídico nem substitui a leitura integral do edital e a validação por um profissional habilitado.',
    demoFile: 'edital-demo.pdf',
  },
} as const;

/** O motor de IA está configurado? (chave presente) */
export const hasAIProvider = (): boolean => config.ai.apiKey.length > 0;

export type AppConfig = typeof config;
