/**
 * Radar da empresa (T-217): oportunidades + a melhor `MatchScore` entre os perfis ATIVOS que a aceitam.
 *
 *  - Uma linha por oportunidade (a nota mais alta; empate → menor id de perfil, determinístico).
 *  - Só conta a nota que atinge o `minScore` do próprio perfil (é a "nota mínima para entrar no radar").
 *  - Perfil inativo não aparece: desativar tira a oportunidade do radar sem apagar a nota.
 *  - Isolamento: toda leitura de `match_scores` filtra `company_id`; nada de outra empresa chega aqui.
 *  - Ordem: nota (desc), id da oportunidade (asc). Cursor por chave (nota, id), estável sob inserções.
 *
 * Reaproveita, sem copiar regra: situação efetiva (ADR-018) e busca indexada (ADR-024) de `sources/read`.
 */
import { and, asc, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { bandOf } from '../../analysis/fit/commercial';
import type { Db } from '../../db';
import { matchScores, opportunities, searchProfiles, sources } from '../../db/schema';
import { decodeCursor, encodeCursor, InvalidCursor } from '../../sources/read/cursor';
import { opportunitySearchCondition, toOpportunityView } from '../../sources/read/opportunities';
import { effectiveStatusCondition } from '../../sources/read/status';
import { DEFAULT_RADAR_STATUS, type RadarMatch, type RadarQuery } from './dto';

const SORT = 'score_desc';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Data pura (YYYY-MM-DD) = dia inteiro em America/Sao_Paulo: início no limite inferior, fim no superior. */
const dateOrNull = (v: string | undefined, edge: 'start' | 'end') =>
  v ? new Date(v.length === 10 ? `${v}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}-03:00` : v) : null;

/** Cursor da ordenação por nota: `k` = nota (0..100) e `id` = uuid. Qualquer outra coisa é 400 (nunca vai ao SQL). */
function scoreCursor(raw: string): { score: number; id: string } {
  const c = decodeCursor(raw, SORT);
  const score = Number(c.k);
  if (c.k === null || !Number.isInteger(score) || score < 0 || score > 100 || !UUID.test(c.id)) throw new InvalidCursor();
  return { score, id: c.id };
}

export async function listRadar(db: Db, companyId: string, q: RadarQuery, now = new Date()) {
  // 1) Melhor nota por oportunidade, só de perfis ativos desta empresa que aceitam a nota.
  const best = db
    .selectDistinctOn([matchScores.opportunityId], {
      // Alias explícito: `match_scores.id` e `search_profiles.id` (e `name`) colidiriam no subselect.
      matchId: sql<string>`${matchScores.id}`.as('match_id'),
      opportunityId: matchScores.opportunityId,
      score: matchScores.score,
      caps: matchScores.caps,
      primaryCategory: matchScores.primaryCategory,
      computedAt: matchScores.computedAt,
      profileId: sql<string>`${searchProfiles.id}`.as('profile_id'),
      profileName: sql<string>`${searchProfiles.name}`.as('profile_name'),
    })
    .from(matchScores)
    .innerJoin(searchProfiles, and(eq(searchProfiles.id, matchScores.searchProfileId), eq(searchProfiles.companyId, matchScores.companyId)))
    .where(
      and(
        eq(matchScores.companyId, companyId),
        eq(searchProfiles.active, true),
        gte(matchScores.score, searchProfiles.minScore),
        q.minScore === undefined ? undefined : gte(matchScores.score, q.minScore),
        q.profileId ? eq(searchProfiles.id, q.profileId) : undefined,
        q.category ? inArray(matchScores.primaryCategory, q.category) : undefined,
      ),
    )
    .orderBy(matchScores.opportunityId, desc(matchScores.score), asc(searchProfiles.id))
    .as('best');

  // 2) Filtros da oportunidade (mesmas regras do /opportunities) + cursor.
  const where: SQL[] = [effectiveStatusCondition(q.status ?? DEFAULT_RADAR_STATUS, now)];
  if (q.q) where.push(opportunitySearchCondition(q.q));
  if (q.ufs) where.push(inArray(opportunities.uf, q.ufs));
  if (q.modalities) where.push(inArray(opportunities.modalityCode, q.modalities));
  const from = dateOrNull(q.closesFrom, 'start');
  const to = dateOrNull(q.closesTo, 'end');
  if (from) where.push(sql`${opportunities.proposalsCloseAt} >= ${from.toISOString()}::timestamptz`);
  if (to) where.push(sql`${opportunities.proposalsCloseAt} <= ${to.toISOString()}::timestamptz`);
  if (q.cursor) {
    const c = scoreCursor(q.cursor);
    where.push(sql`(${best.score} < ${c.score} or (${best.score} = ${c.score} and ${opportunities.id} > ${c.id}::uuid))`);
  }

  const rows = await db
    .select({
      o: opportunities,
      sourceKey: sources.key,
      m: { matchId: best.matchId, score: best.score, caps: best.caps, primaryCategory: best.primaryCategory, computedAt: best.computedAt, profileId: best.profileId, profileName: best.profileName },
    })
    .from(best)
    .innerJoin(opportunities, eq(opportunities.id, best.opportunityId))
    .innerJoin(sources, eq(sources.id, opportunities.primarySourceId))
    .where(and(...where))
    .orderBy(desc(best.score), asc(opportunities.id))
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      opportunity: toOpportunityView(r.o, r.sourceKey, now),
      match: {
        id: r.m.matchId,
        score: r.m.score,
        band: bandOf(r.m.score),
        primaryCategory: r.m.primaryCategory,
        caps: r.m.caps,
        computedAt: r.m.computedAt.toISOString(),
        searchProfileId: r.m.profileId,
        searchProfileName: r.m.profileName,
      } satisfies RadarMatch,
    })),
    nextCursor: rows.length > q.limit && last ? encodeCursor({ s: SORT, k: String(last.m.score), id: last.o.id }) : null,
  };
}
