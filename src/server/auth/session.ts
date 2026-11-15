/** Sessões server-side: token aleatório no cookie, hash no banco, expiração absoluta e por inatividade. */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db';
import { companies, memberships, sessions, userAccounts } from '../db/schema';
import { SESSION_IDLE_S, SESSION_MAX_AGE_S } from './config';
import type { LoginClaims } from './oidc';
import { AuthError } from './errors';

export type RealmRole = 'nett_admin' | 'nett_consultant';
export type Session = {
  id: string;
  user: { id: string; email: string; name: string };
  realmRoles: RealmRole[];
  expiresAt: Date;
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Provisiona/atualiza o usuário pelo `sub` do Keycloak. Usuário desativado no app não entra. */
export async function provisionUser(db: Db, claims: Pick<LoginClaims, 'sub' | 'email' | 'name'>) {
  const [user] = await db
    .insert(userAccounts)
    .values({ keycloakSub: claims.sub, email: claims.email, name: claims.name })
    .onConflictDoUpdate({ target: userAccounts.keycloakSub, set: { email: claims.email, name: claims.name } })
    .returning();
  if (!user.active) throw new AuthError('USER_INACTIVE', 403, 'Usuário desativado.');
  return user;
}

export async function createSession(db: Db, userId: string, realmRoles: RealmRole[], now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_S * 1000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, realmRoles, createdAt: now, lastSeenAt: now, expiresAt });
  return { token, expiresAt };
}

/** Resolve o token do cookie. Retorna null se ausente, revogada, expirada, ociosa ou usuário inativo. */
export async function resolveSession(db: Db, token: string | undefined, now = new Date()): Promise<Session | null> {
  if (!token || token.length > 128) return null;
  const [row] = await db
    .select({ s: sessions, u: userAccounts })
    .from(sessions)
    .innerJoin(userAccounts, eq(userAccounts.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .limit(1);
  if (!row || !row.u.active) return null;
  if (row.s.expiresAt <= now || now.getTime() - row.s.lastSeenAt.getTime() > SESSION_IDLE_S * 1000) return null;
  if (now.getTime() - row.s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.s.id));
  }
  return {
    id: row.s.id,
    user: { id: row.u.id, email: row.u.email, name: row.u.name },
    realmRoles: row.s.realmRoles.filter((r): r is RealmRole => r === 'nett_admin' || r === 'nett_consultant'),
    expiresAt: row.s.expiresAt,
  };
}

export async function revokeSession(db: Db, token: string | undefined, now = new Date()) {
  if (!token) return;
  await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

/** Empresas visíveis para a sessão (nett_admin vê todas as ativas). */
export async function listAccessibleCompanies(db: Db, session: Session) {
  if (session.realmRoles.includes('nett_admin')) {
    const rows = await db.select({ id: companies.id, legalName: companies.legalName }).from(companies).where(eq(companies.status, 'active'));
    return rows.map((r) => ({ ...r, role: 'company_admin' as const }));
  }
  return db
    .select({ id: companies.id, legalName: companies.legalName, role: memberships.role })
    .from(memberships)
    .innerJoin(companies, eq(companies.id, memberships.companyId))
    .where(and(eq(memberships.userId, session.user.id), eq(companies.status, 'active')));
}
