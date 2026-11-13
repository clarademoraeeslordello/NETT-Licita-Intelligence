/** Contrato do endpoint /api/health usado pela interface. */
export type Capabilities = {
  ai: {
    configured: boolean;
    provider: string;
    baseUrl: string;
    model: string;
    synthesisModel: string;
  };
  report: {
    pdfAvailable: boolean;
    browser: string | null;
    reason: string | null;
  };
  limits: {
    maxUploadMb: number;
    maxPages: number;
    singleCallMaxChars: number;
    chunkChars: number;
    concurrency: number;
  };
  demo: {
    available: boolean;
    fileName: string;
    label: string;
  };
  /** true quando a verificação de capacidades falhou (não confundir com "IA desligada"). */
  degraded?: boolean;
};

export const FALLBACK_CAPABILITIES: Capabilities = {
  ai: {
    configured: false,
    provider: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    synthesisModel: 'deepseek-chat',
  },
  report: { pdfAvailable: false, browser: null, reason: 'Não foi possível consultar o servidor.' },
  limits: {
    maxUploadMb: 25,
    maxPages: 600,
    singleCallMaxChars: 60000,
    chunkChars: 14000,
    concurrency: 3,
  },
  demo: {
    available: true,
    fileName: 'edital-demo.pdf',
    label: 'Edital de demonstração',
  },
};
