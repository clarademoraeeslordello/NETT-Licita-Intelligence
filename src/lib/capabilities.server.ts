import { config, hasAIProvider } from './config';
import { browserStatus } from './report/browser';
import { FALLBACK_CAPABILITIES, type Capabilities } from './api-types';

/**
 * Capacidades do ambiente, coletadas EM PROCESSO.
 *
 * Chamada diretamente pelo Route Handler e pela página (server component):
 * sem auto-fetch HTTP, portanto sem dependência do cabeçalho Host enviado pelo
 * cliente e sem custo de rede adicional na renderização.
 */
export async function collectCapabilities(): Promise<Capabilities> {
  const browser = await browserStatus();

  return {
    ai: {
      configured: hasAIProvider(),
      provider: config.ai.provider === 'gemini' ? 'Google Gemini' : 'DeepSeek',
      baseUrl: config.ai.baseUrl,
      model: config.ai.model,
      synthesisModel: config.ai.synthesisModel,
    },
    report: {
      pdfAvailable: browser.available,
      browser: browser.path ? browser.path.split(/[\\/]/).pop() ?? null : null,
      reason: browser.reason ?? null,
    },
    limits: {
      maxUploadMb: Math.round(config.upload.maxBytes / (1024 * 1024)),
      maxPages: config.upload.maxPages,
      singleCallMaxChars: config.chunking.singleCallMaxChars,
      chunkChars: config.chunking.chunkChars,
      concurrency: config.chunking.concurrency,
    },
    demo: {
      available: true,
      fileName: config.app.demoFile,
      label: 'Pregão Eletrônico nº 042/2025 — Prefeitura Municipal de Vale Verde',
    },
  };
}

/** Capacidades com aviso explícito de indisponibilidade (nunca "mente" sobre a IA). */
export function degradedCapabilities(): Capabilities & { degraded: true } {
  return { ...FALLBACK_CAPABILITIES, degraded: true };
}
