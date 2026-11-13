/**
 * Armazenamento em memória das análises.
 *
 * Decisão de arquitetura: para um MVP demonstrável, guardar o resultado no
 * servidor (e não no browser) mantém o payload grande fora do cliente, permite
 * que a rota de geração de PDF renderize o relatório sem reenviar dados e evita
 * persistir documentos de clientes em disco.
 *
 * Limitação conhecida (documentada no README): o store é volátil e por
 * instância. Em produção, trocar por Postgres/Supabase + storage de objetos.
 */
import { randomUUID } from 'node:crypto';
import type { AnalysisResult, AnaliseEditais } from './schema';

export type JobStage =
  | 'received'
  | 'extracting'
  | 'analyzing'
  | 'structuring'
  | 'reporting'
  | 'done'
  | 'error';

export type JobEvent = {
  stage: JobStage;
  /** 0 a 100 */
  progress: number;
  message: string;
  detail?: string;
  at: number;
};

export type JobStep = {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
};

export type Job = {
  id: string;
  fileName: string;
  fileSize: number;
  createdAt: number;
  updatedAt: number;
  stage: JobStage;
  progress: number;
  steps: JobStep[];
  events: JobEvent[];
  meta: {
    pages?: number;
    chars?: number;
    words?: number;
    engine?: string;
  };
  result?: AnalysisResult;
  error?: { code: string; message: string; hint?: string; details?: string };
  isDemo: boolean;
  /** true quando o resultado veio do cache e está sendo reencenado na interface. */
  replayed?: boolean;
};

export const STEP_DEFINITIONS: Array<{ id: string; label: string }> = [
  { id: 'received', label: 'Documento recebido' },
  { id: 'extracting', label: 'Extraindo conteúdo' },
  { id: 'analyzing', label: 'Analisando edital' },
  { id: 'structuring', label: 'Estruturando informações' },
  { id: 'reporting', label: 'Gerando relatório' },
];

const STAGE_ORDER: JobStage[] = ['received', 'extracting', 'analyzing', 'structuring', 'reporting', 'done'];

type Store = {
  jobs: Map<string, Job>;
  byHash: Map<string, string>;
  order: string[];
};

// Mantém o store vivo entre recarregamentos em desenvolvimento (HMR).
const globalRef = globalThis as unknown as { __editaisStore?: Store };
const store: Store =
  globalRef.__editaisStore ??
  (globalRef.__editaisStore = { jobs: new Map(), byHash: new Map(), order: [] });

const MAX_JOBS = 40;
const TTL_MS = 1000 * 60 * 60 * 6; // 6 horas

function evict(): void {
  const now = Date.now();
  for (const [id, job] of store.jobs) {
    // Nunca descartamos um job em andamento: o stream do usuário receberia
    // "análise não encontrada" no meio do processamento.
    if (job.stage !== 'done' && job.stage !== 'error') continue;
    if (now - job.updatedAt > TTL_MS) {
      store.jobs.delete(id);
      store.order = store.order.filter((entry) => entry !== id);
      for (const [hash, jobId] of store.byHash) if (jobId === id) store.byHash.delete(hash);
    }
  }

  // Limite por quantidade: remove os mais antigos que já terminaram.
  while (store.order.length > MAX_JOBS) {
    const oldest = store.order.find((id) => {
      const job = store.jobs.get(id);
      return !job || job.stage === 'done' || job.stage === 'error';
    });
    if (!oldest) break;
    const job = store.jobs.get(oldest);
    store.order = store.order.filter((entry) => entry !== oldest);
    store.jobs.delete(oldest);
    if (job) for (const [hash, jobId] of store.byHash) if (jobId === oldest) store.byHash.delete(hash);
  }
}

export function createJob(input: { fileName: string; fileSize: number; isDemo?: boolean }): Job {
  evict();
  const now = Date.now();
  const job: Job = {
    id: randomUUID(),
    fileName: input.fileName,
    fileSize: input.fileSize,
    createdAt: now,
    updatedAt: now,
    stage: 'received',
    progress: 2,
    steps: STEP_DEFINITIONS.map((step, index) => ({
      id: step.id,
      label: step.label,
      status: index === 0 ? 'active' : 'pending',
    })),
    events: [
      {
        stage: 'received',
        progress: 2,
        message: 'Documento recebido',
        detail: `${input.fileName} · ${formatBytes(input.fileSize)}`,
        at: now,
      },
    ],
    meta: {},
    isDemo: Boolean(input.isDemo),
  };
  store.jobs.set(job.id, job);
  store.order.push(job.id);
  return job;
}

/** Atualiza o estágio do job, mantendo a trilha de eventos para o frontend. */
export function updateJob(  id: string,
  patch: {
    stage?: JobStage;
    progress?: number;
    message?: string;
    detail?: string;
    meta?: Partial<Job['meta']>;
    result?: AnalysisResult;
    error?: Job['error'];
  },
): Job | undefined {
  const job = store.jobs.get(id);
  if (!job) return undefined;
  const now = Date.now();

  if (patch.stage) job.stage = patch.stage;
  if (typeof patch.progress === 'number') job.progress = Math.max(job.progress, Math.min(100, Math.round(patch.progress)));
  if (patch.meta) job.meta = { ...job.meta, ...patch.meta };
  if (patch.result) job.result = patch.result;
  if (patch.error) job.error = patch.error;
  job.updatedAt = now;

  if (patch.message) {
    job.events.push({
      stage: job.stage,
      progress: job.progress,
      message: patch.message,
      detail: patch.detail,
      at: now,
    });
  }

  const currentIndex = STAGE_ORDER.indexOf(job.stage);
  job.steps = job.steps.map((step) => {
    const stepIndex = STAGE_ORDER.indexOf(step.id as JobStage);
    if (job.stage === 'error') {
      return step.status === 'active' ? { ...step, status: 'error', detail: patch.detail } : step;
    }
    if (stepIndex < currentIndex) return { ...step, status: 'done' };
    if (stepIndex === currentIndex) return { ...step, status: 'active', detail: patch.detail ?? step.detail };
    return { ...step, status: 'pending' };
  });

  if (job.stage === 'done') job.steps = job.steps.map((step) => ({ ...step, status: 'done' }));
  return job;
}

/**
 * Prepara um job já concluído para ser transmitido novamente.
 *
 * Usado quando o mesmo arquivo é reanalisado e o resultado é reaproveitado do
 * cache: mantemos `stage = 'done'` com `result` presente — é esse par que faz o
 * stream (src/lib/stream.ts) encerrar imediatamente com o evento `done` e um
 * marcador de reuso, sem deixar a interface esperando um processamento que não
 * vai acontecer. Nenhum documento é reprocessado e nenhum token é gasto.
 */
export function restartJob(id: string): Job | undefined {
  const job = store.jobs.get(id);
  if (!job?.result) return undefined;

  job.updatedAt = Date.now();
  job.replayed = true;
  return job;
}

/** Coloca na memória desta instância um job concluído que veio do banco. */
export function adoptJob(job: Job, hash?: string): Job {
  const existente = store.jobs.get(job.id);
  if (existente) return existente;
  store.jobs.set(job.id, job);
  store.order.push(job.id);
  if (hash) store.byHash.set(hash, job.id);
  evict();
  return job;
}

export function getJob(id: string): Job | undefined {
  return store.jobs.get(id);
}

/**
 * Ajusta os metadados de apresentação de um job reaproveitado.
 * Quando o mesmo PDF chega por upload depois de ter sido analisado pela
 * demonstração (ou vice-versa), o selo exibido precisa refletir a origem real
 * desta requisição.
 */
export function refreshJobPresentation(id: string, input: { fileName: string; isDemo: boolean }): Job | undefined {
  const job = store.jobs.get(id);
  if (!job) return undefined;
  job.fileName = input.fileName;
  job.isDemo = input.isDemo;
  job.updatedAt = Date.now();
  return job;
}

/** Índice por hash do arquivo: evita reprocessar o mesmo PDF na demo. */
export function findByHash(hash: string): Job | undefined {
  const id = store.byHash.get(hash);
  return id ? store.jobs.get(id) : undefined;
}

export function linkHash(hash: string, jobId: string): void {
  store.byHash.set(hash, jobId);
}

/** Desfaz o vínculo do cache (resultado que não deve ser reaproveitado). */
export function unlinkHash(hash: string): void {
  store.byHash.delete(hash);
}

/** Versão pública do job: omite a análise completa (payload grande). */
export function toPublicJob(job: Job) {
  return {
    id: job.id,
    fileName: job.fileName,
    fileSize: job.fileSize,
    fileSizeLabel: formatBytes(job.fileSize),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    stage: job.stage,
    progress: job.progress,
    steps: job.steps,
    events: job.events,
    meta: job.meta,
    error: job.error,
    isDemo: job.isDemo,
    replayed: Boolean(job.replayed),
    hasResult: Boolean(job.result),
    engine: job.result?.meta.engine,
  };
}

export type PublicJob = ReturnType<typeof toPublicJob>;

export function getAnalysis(id: string): { job: Job; analise: AnaliseEditais } | undefined {
  const job = store.jobs.get(id);
  if (!job?.result) return undefined;
  return { job, analise: job.result.analise };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}
