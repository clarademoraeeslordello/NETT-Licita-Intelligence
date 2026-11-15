/**
 * Limite de requisições por janela fixa no Postgres (T-107): funciona com várias instâncias.
 * Falha aberta (permite) se o banco estiver indisponível — o erro é registrado.
 */
import { lt, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { rateLimitBuckets } from '../db/schema';

export type RateLimitRule = { name: string; limit: number; windowSeconds: number };

export const RULES = {
  /** Login/callback por IP. */
  auth: { name: 'auth', limit: 20, windowSeconds: 60 },
  /** API autenticada por sessão (ou IP quando sem sessão). */
  api: { name: 'api', limit: 300, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export async function consumeRateLimit(db: Db, rule: RateLimitRule, subjectHash: string, now = new Date()): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
  try {
    const [row] = await db
      .insert(rateLimitBuckets)
      .values({ key: `${rule.name}:${subjectHash}`, windowStart, count: 1 })
      .onConflictDoUpdate({ target: [rateLimitBuckets.key, rateLimitBuckets.windowStart], set: { count: sql`${rateLimitBuckets.count} + 1` } })
      .returning({ count: rateLimitBuckets.count });
    if (Math.random() < 0.01) {
      await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.windowStart, new Date(now.getTime() - 3600_000)));
    }
    return { allowed: row.count <= rule.limit, remaining: Math.max(0, rule.limit - row.count), retryAfterSeconds };
  } catch (e) {
    console.error('[rate-limit] indisponível, permitindo:', e instanceof Error ? e.message : e);
    return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
  }
}
