/**
 * Contrato das filas (pg-boss). Payload só com IDs e parâmetros — nunca conteúdo de documento,
 * dados pessoais ou segredos. Handlers DEVEM ser idempotentes.
 * Runner/registro: agente 02 (worker/). Handler: dono indicado em `owner`.
 */
import { z } from 'zod';
import { isoDate, isoDateTime, uuid } from './common';
import { metricGranularity } from './metrics';

export const jobs = {
  'source.sync': {
    owner: '02',
    payload: z.object({
      sourceKey: z.string(),
      mode: z.enum(['incremental', 'backfill']),
      since: isoDateTime.optional(),
    }),
  },
  'source.normalize': {
    owner: '02',
    payload: z.object({ sourceRecordId: uuid }),
  },
  'document.fetch': {
    owner: '02',
    payload: z.object({ documentId: uuid }),
  },
  'document.extract': {
    owner: '03',
    payload: z.object({ documentId: uuid }),
  },
  'analysis.run': {
    owner: '03',
    payload: z.object({ analysisId: uuid }),
  },
  'match.score': {
    owner: '03',
    /** companyId ausente = todos os SearchProfiles ativos. */
    payload: z.object({ opportunityId: uuid, companyId: uuid.optional() }),
  },
  'metrics.compute': {
    owner: '04',
    payload: z.object({ granularity: metricGranularity, periodStart: isoDate }),
  },
} as const;

export type JobName = keyof typeof jobs;
export type JobPayload<N extends JobName> = z.infer<(typeof jobs)[N]['payload']>;

/** Política padrão. Exceções exigem ADR. */
export const JOB_DEFAULTS = {
  retryLimit: 3,
  retryBackoff: true,
  expireInSeconds: 15 * 60,
} as const;

/**
 * Encadeamento canônico (quem enfileira o quê):
 *  source.sync        → source.normalize (por registro novo/alterado)
 *  source.normalize   → document.fetch (anexos novos) + match.score (se contentHash mudou)
 *  document.fetch     → document.extract
 *  document.extract   → (nada; análise é sob demanda ou por regra de perfil)
 *  POST /analyses     → analysis.run
 *  cron diário        → metrics.compute
 */
