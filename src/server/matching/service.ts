/**
 * match.score handler logic (T-305): persists one MatchScore per active SearchProfile, and reads summaries
 * for the pipeline cards. Row → contract mapping is validated; nobody outside this module reads the raw rows.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  opportunity as opportunitySchema,
  searchProfile as searchProfileSchema,
  type Opportunity,
  type OpportunityItem,
  type SearchProfile,
} from '../../contracts';
import { bandOf } from '../analysis/fit/commercial';
import type { NettCategory } from '../analysis/fit/dictionary';
import type { Db } from '../db';
import { companies, matchScores, opportunities, opportunityItems, searchProfiles, sources } from '../db/schema';
import { algorithmVersionOf, computeMatch } from './score';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toOpportunity(row: typeof opportunities.$inferSelect): Opportunity {
  return opportunitySchema.parse({
    ...row,
    publishedAt: iso(row.publishedAt),
    proposalsOpenAt: iso(row.proposalsOpenAt),
    proposalsCloseAt: iso(row.proposalsCloseAt),
    sessionAt: iso(row.sessionAt),
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function toSearchProfile(row: typeof searchProfiles.$inferSelect): SearchProfile {
  return searchProfileSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
}

/** The score depends on "days to close", so a stored score is recomputed after this age even if nothing changed. */
export const MAX_SCORE_AGE_MS = 24 * 3_600_000;

export type ScoreRun = { opportunityFound: boolean; profiles: number; written: number; skipped: number };

/**
 * Scores `opportunityId` for every active SearchProfile of active companies (or only `companyId`).
 * Idempotent: a profile is skipped when the stored score has the same content hash and algorithm version,
 * the profile did not change since, and it is younger than MAX_SCORE_AGE_MS.
 */
export async function scoreOpportunity(db: Db, p: { opportunityId: string; companyId?: string }, now = new Date()): Promise<ScoreRun> {
  const [oppRow] = await db.select().from(opportunities).where(eq(opportunities.id, p.opportunityId));
  if (!oppRow) return { opportunityFound: false, profiles: 0, written: 0, skipped: 0 }; // nothing to retry
  const [src] = await db.select({ key: sources.key }).from(sources).where(eq(sources.id, oppRow.primarySourceId));
  const opp = toOpportunity(oppRow);
  const items = await db.select({ number: opportunityItems.number, description: opportunityItems.description }).from(opportunityItems).where(eq(opportunityItems.opportunityId, opp.id));

  const profileRows = await db
    .select({ profile: searchProfiles })
    .from(searchProfiles)
    .innerJoin(companies, eq(companies.id, searchProfiles.companyId))
    .where(and(eq(searchProfiles.active, true), eq(companies.status, 'active'), p.companyId ? eq(searchProfiles.companyId, p.companyId) : undefined));

  const algorithmVersion = algorithmVersionOf();
  const existing = new Map((await db.select().from(matchScores).where(eq(matchScores.opportunityId, opp.id))).map((m) => [m.searchProfileId, m]));
  let written = 0;
  let skipped = 0;
  let considered = 0;
  for (const { profile: row } of profileRows) {
    if (row.sourceKeys.length > 0 && !(src && row.sourceKeys.includes(src.key))) continue; // profile does not follow this source
    considered += 1;
    const prev = existing.get(row.id);
    if (prev && prev.opportunityContentHash === opp.contentHash && prev.algorithmVersion === algorithmVersion && prev.computedAt >= row.updatedAt && now.getTime() - prev.computedAt.getTime() < MAX_SCORE_AGE_MS) {
      skipped += 1;
      continue;
    }
    const m = computeMatch({ opportunity: opp, items, profile: toSearchProfile(row), now });
    const values = { score: m.score, factors: m.factors, caps: m.caps, algorithmVersion: m.algorithmVersion, opportunityContentHash: opp.contentHash, computedAt: now };
    await db
      .insert(matchScores)
      .values({ opportunityId: opp.id, companyId: row.companyId, searchProfileId: row.id, ...values })
      .onConflictDoUpdate({ target: [matchScores.searchProfileId, matchScores.opportunityId], set: values });
    written += 1;
  }
  return { opportunityFound: true, profiles: considered, written, skipped };
}

export type MatchSummary = { score: number; band: 'high' | 'medium' | 'low'; primaryCategory: NettCategory | null };

export const MAX_SUMMARY_IDS = 200;

/**
 * Pipeline cards (agent 04): the best stored score of the company's ACTIVE profiles per opportunity, with its
 * band and the Nett category. Opportunities without a stored score are absent from the result. Only this
 * company's scores are read. The category is derived with the same classification as the score.
 */
export async function getMatchSummaries(db: Db, companyId: string, opportunityIds: string[]): Promise<Record<string, MatchSummary>> {
  const ids = [...new Set(opportunityIds)];
  if (ids.length === 0) return {};
  if (ids.length > MAX_SUMMARY_IDS) throw new RangeError(`no máximo ${MAX_SUMMARY_IDS} oportunidades por consulta`);
  const best = await db
    .select({ opportunityId: matchScores.opportunityId, score: sql<number>`max(${matchScores.score})::int` })
    .from(matchScores)
    .innerJoin(searchProfiles, and(eq(searchProfiles.id, matchScores.searchProfileId), eq(searchProfiles.active, true)))
    .where(and(eq(matchScores.companyId, companyId), inArray(matchScores.opportunityId, ids)))
    .groupBy(matchScores.opportunityId);
  if (best.length === 0) return {};
  const scored = best.map((b) => b.opportunityId);
  const [oppRows, itemRows] = await Promise.all([
    db.select().from(opportunities).where(inArray(opportunities.id, scored)),
    db.select({ opportunityId: opportunityItems.opportunityId, number: opportunityItems.number, description: opportunityItems.description }).from(opportunityItems).where(inArray(opportunityItems.opportunityId, scored)),
  ]);
  const itemsBy = new Map<string, Pick<OpportunityItem, 'number' | 'description'>[]>();
  for (const it of itemRows) itemsBy.set(it.opportunityId, [...(itemsBy.get(it.opportunityId) ?? []), it]);
  const out: Record<string, MatchSummary> = {};
  for (const row of oppRows) {
    const stored = best.find((b) => b.opportunityId === row.id)!;
    const { primaryCategory } = computeMatch({ opportunity: toOpportunity(row), items: itemsBy.get(row.id) ?? [], profile: null });
    out[row.id] = { score: stored.score, band: bandOf(stored.score), primaryCategory };
  }
  return out;
}
