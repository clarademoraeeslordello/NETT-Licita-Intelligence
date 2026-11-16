/**
 * match.refresh and match.profile (contracts 1.4.0, ADR-025): fan out `match.score` jobs.
 * Neither handler scores anything itself; they only enqueue (CONTRACTS §3: handlers never call each other).
 * `match.score` is a "stately" singleton per payload, so re-enqueueing the same pair is harmless.
 */
import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db';
import { companies, opportunities, searchProfiles, sources } from '../db/schema';

/** Opportunities still receiving proposals (or about to). Terminal statuses never need a fresh score. */
export const OPEN_STATUSES = ['published', 'receiving_proposals'] as const;
export const FANOUT_BATCH = 500;
const DAY = 86_400_000;
/** The deadline band of the score changes within this window around "now" (see commercial.ts). */
export const REFRESH_WINDOW = { pastDays: 1, aheadDays: 8 } as const;

export type FanoutDeps = {
  db: Db;
  /** Enqueues `match.score`. Injected so tests run without pg-boss; the worker passes `enqueueWith(boss, 'match.score', …)`. */
  enqueue: (payload: { opportunityId: string; companyId?: string }) => Promise<unknown>;
};

async function inChunks<T>(items: T[], size: number, fn: (x: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/** Keyset pagination by id over `where`, FANOUT_BATCH rows at a time. */
async function* openIds(db: Db, where: SQL | undefined): AsyncGenerator<string[]> {
  let last: string | null = null;
  for (;;) {
    const rows: { id: string }[] = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(inArray(opportunities.status, [...OPEN_STATUSES]), where, last ? gt(opportunities.id, last) : undefined))
      .orderBy(asc(opportunities.id))
      .limit(FANOUT_BATCH);
    if (rows.length === 0) return;
    yield rows.map((r) => r.id);
    last = rows.at(-1)!.id;
    if (rows.length < FANOUT_BATCH) return;
  }
}

const anyActiveProfile = async (db: Db) => {
  const [r] = await db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .innerJoin(companies, eq(companies.id, searchProfiles.companyId))
    .where(and(eq(searchProfiles.active, true), eq(companies.status, 'active')))
    .limit(1);
  return !!r;
};

/** Daily: re-enqueue `match.score` for open opportunities whose deadline is near (the deadline factor moves there). */
export async function refreshOpenOpportunities(deps: FanoutDeps, now = new Date()): Promise<{ enqueued: number }> {
  if (!(await anyActiveProfile(deps.db))) return { enqueued: 0 }; // nobody to score for
  const from = new Date(now.getTime() - REFRESH_WINDOW.pastDays * DAY);
  const to = new Date(now.getTime() + REFRESH_WINDOW.aheadDays * DAY);
  let enqueued = 0;
  for await (const ids of openIds(deps.db, and(gte(opportunities.proposalsCloseAt, from), lte(opportunities.proposalsCloseAt, to)))) {
    await inChunks(ids, 25, (opportunityId) => deps.enqueue({ opportunityId }));
    enqueued += ids.length;
  }
  return { enqueued };
}

/**
 * SQL form of the hard filters in eligibility.ts, as a SUPERSET: unknown UF / modality / value is kept, and the
 * terms test is left to match.score (it needs text). A candidate this lets through may still be discarded there.
 */
export function profileCandidates(p: typeof searchProfiles.$inferSelect): SQL | undefined {
  const parts: (SQL | undefined)[] = [
    p.ufs.length ? or(isNull(opportunities.uf), inArray(opportunities.uf, p.ufs)) : undefined,
    p.modalityCodes.length ? or(isNull(opportunities.modalityCode), inArray(opportunities.modalityCode, p.modalityCodes)) : undefined,
    p.minValue !== null ? or(isNull(opportunities.estimatedValue), gte(opportunities.estimatedValue, p.minValue)) : undefined,
    p.maxValue !== null ? or(isNull(opportunities.estimatedValue), lte(opportunities.estimatedValue, p.maxValue)) : undefined,
    p.sourceKeys.length ? sql`${opportunities.primarySourceId} in (select id from ${sources} where ${inArray(sources.key, p.sourceKeys)})` : undefined,
  ];
  return and(...parts);
}

/** A profile was created or changed: enqueue `match.score {opportunityId, companyId}` for the open opportunities it can match. */
export async function fanOutProfile(deps: FanoutDeps, searchProfileId: string): Promise<{ enqueued: number }> {
  const [row] = await deps.db
    .select({ profile: searchProfiles })
    .from(searchProfiles)
    .innerJoin(companies, eq(companies.id, searchProfiles.companyId))
    .where(and(eq(searchProfiles.id, searchProfileId), eq(searchProfiles.active, true), eq(companies.status, 'active')));
  if (!row) return { enqueued: 0 }; // gone, inactive or suspended company: nothing to do and nothing to retry
  const { profile } = row;
  let enqueued = 0;
  for await (const ids of openIds(deps.db, profileCandidates(profile))) {
    await inChunks(ids, 25, (opportunityId) => deps.enqueue({ opportunityId, companyId: profile.companyId }));
    enqueued += ids.length;
  }
  return { enqueued };
}

/** Daily refresh, 05:10 America/Sao_Paulo (the runner sets the time zone). Empty value disables it. */
export function matchSchedules(env: Record<string, string | undefined> = process.env) {
  const cron = env.MATCH_REFRESH_CRON ?? '10 5 * * *';
  return cron ? [{ name: 'match.refresh' as const, cron, data: {} }] : [];
}
