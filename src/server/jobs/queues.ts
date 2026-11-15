/**
 * Configuração das filas a partir do contrato (`src/contracts/jobs.ts`).
 * Política `stately`: no máximo um job por `singletonKey` em cada estado (na fila / em execução),
 * o que torna o enfileiramento idempotente — o mesmo payload enfileirado duas vezes vira um job.
 */
import type { PgBoss } from 'pg-boss';
import { JOB_DEFAULTS, jobs, type JobName } from '@/contracts/jobs';

export const jobNames = Object.keys(jobs) as JobName[];

export const QUEUE_OPTIONS = {
  policy: 'stately',
  retryLimit: JOB_DEFAULTS.retryLimit,
  retryBackoff: JOB_DEFAULTS.retryBackoff,
  retryDelay: 30,
  retryDelayMax: 3_600,
  expireInSeconds: JOB_DEFAULTS.expireInSeconds,
  // Concluídos ficam 14 dias para auditoria/diagnóstico.
  deleteAfterSeconds: 14 * 24 * 3600,
} as const;

/** Cria (ou alinha) todas as filas do contrato. Idempotente. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  const existentes = new Set((await boss.getQueues()).map((q) => q.name));
  for (const name of jobNames) {
    if (existentes.has(name)) {
      const { policy: _policy, ...mutaveis } = QUEUE_OPTIONS;
      await boss.updateQueue(name, mutaveis);
    } else {
      await boss.createQueue(name, QUEUE_OPTIONS);
    }
  }
}
