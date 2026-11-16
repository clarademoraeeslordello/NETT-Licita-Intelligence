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
  /**
   * 1.3.0 (ADR-021): retentar o enriquecimento (itens e arquivos) de um SourceRecord que casou com um
   * SearchProfile mas ficou só com a listagem porque a fonte falhou. O handler grava uma NOVA versão
   * enriquecida do SourceRecord (a antiga nunca é alterada) e enfileira `source.normalize`.
   */
  'source.enrich': {
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
  /**
   * 1.4.0 (ADR-025): reavaliação diária das oportunidades abertas, porque o prazo entra na nota.
   * Agendado às 05:10 America/Sao_Paulo. O handler enfileira `match.score` para oportunidades abertas com
   * `proposalsCloseAt` entre agora − 1 dia e agora + 8 dias (onde a faixa do prazo muda).
   */
  'match.refresh': {
    owner: '03',
    payload: z.object({}),
  },
  /**
   * 1.4.0 (ADR-025): perfil criado ou alterado. O handler percorre as oportunidades abertas em lotes (500)
   * e enfileira `match.score { opportunityId, companyId }`. Quem enfileira: a API de SearchProfile.
   */
  'match.profile': {
    owner: '03',
    payload: z.object({ searchProfileId: uuid }),
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
 *  source.sync        → source.enrich (registro que casou com perfil e cujo enriquecimento falhou)
 *  source.enrich      → source.normalize (nova versão enriquecida)
 *  source.normalize   → document.fetch (anexos novos) + match.score (se contentHash mudou)
 *  document.fetch     → document.extract
 *  document.extract   → match.score (1.4.0: a nota passa a usar o texto público extraído; ver ADR-025)
 *  match.refresh      → match.score (diário; oportunidades abertas perto do prazo)
 *  match.profile      → match.score (perfil criado ou alterado)
 *  POST /analyses     → analysis.run
 *  cron diário        → metrics.compute
 */
