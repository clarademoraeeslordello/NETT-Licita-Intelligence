/**
 * DTOs de GET /api/v1/companies/{cid}/radar (T-217), CONTRACTS §4.
 * Ficam em `src/server/matching/radar` (área do agente 03) porque o agente 03 não escreve em `src/contracts`;
 * o agente 01 pode promovê-los para `src/contracts/api/radar.ts` sem mudar o comportamento.
 */
import { z } from 'zod';
import { isoDateTime, nettCategory, opportunityStatus, uf, uuid } from '../../../contracts';

/** Lista separada por vírgula → array validado por `item`. Vazio/ausente → undefined. */
const csv = <T extends z.ZodType>(item: T, max: number) =>
  z
    .preprocess((v) => (typeof v === 'string' ? v.slice(0, 500).split(',').map((x) => x.trim()).filter(Boolean) : v), z.array(item).min(1).max(max))
    .optional();

const when = z.union([isoDateTime, z.iso.date()]);

/** Radar = o que ainda dá para disputar. Quem quer ver encerradas pede `status=closed` (ou lista as que quiser). */
export const DEFAULT_RADAR_STATUS = ['receiving_proposals', 'published'] as const;

export const radarQuery = z
  .object({
    /** Busca textual indexada (T-215): título, objeto, órgão e município; todas as palavras, mínimo de 3 caracteres. */
    q: z.string().trim().min(3).max(100).optional(),
    ufs: csv(uf, 27),
    modalities: csv(z.coerce.number().int().positive(), 30),
    /** Situação EFETIVA (ADR-018). Ausente = abertas (`receiving_proposals`, `published`). */
    status: csv(opportunityStatus, 7),
    /** Nota mínima ADICIONAL: o `minScore` de cada perfil já vale sempre (é a nota para entrar no radar). */
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    /** Janela do encerramento das propostas; data pura = dia inteiro em America/Sao_Paulo. */
    closesFrom: when.optional(),
    closesTo: when.optional(),
    category: csv(nettCategory, 6),
    /** Restringe a um perfil da empresa. */
    profileId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().max(400).optional(),
  })
  .strict();
export type RadarQuery = z.output<typeof radarQuery>;

/** A melhor nota da oportunidade entre os perfis ATIVOS da empresa que a aceitam (nota >= minScore do perfil). */
export const radarMatch = z.object({
  /** Id do `MatchScore`: é o `subjectId` de uma `HumanReview` com `subjectType = match_score`. */
  id: uuid,
  score: z.number().int().min(0).max(100),
  band: z.enum(['high', 'medium', 'low']),
  primaryCategory: nettCategory.nullable(),
  caps: z.array(z.string()),
  computedAt: isoDateTime,
  searchProfileId: uuid,
  searchProfileName: z.string(),
});
export type RadarMatch = z.infer<typeof radarMatch>;
