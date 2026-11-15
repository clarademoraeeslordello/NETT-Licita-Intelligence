/**
 * Autorização por empresa (CONTRACTS §4). Regras:
 *  - nett_admin: acesso total.
 *  - demais: precisa de Membership na empresa com papel >= minRole; empresa deve estar ativa.
 *  - companyId inválido => 403 (não revela existência).
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db';
import { companies, memberships } from '../db/schema';
import { recordAuditSafe } from '../audit';
import { forbidden } from './errors';
import type { Session } from './session';

export type CompanyRole = 'viewer' | 'consultant' | 'company_admin';
export const ROLE_RANK: Record<CompanyRole, number> = { viewer: 1, consultant: 2, company_admin: 3 };

async function deny(db: Db, session: Session, companyId: string, minRole: CompanyRole, reason: string): Promise<never> {
  await recordAuditSafe(db, {
    action: 'authz.denied',
    outcome: 'denied',
    actorUserId: session.user.id,
    entityType: 'company',
    metadata: { requestedCompanyId: String(companyId).slice(0, 64), minRole, reason },
  });
  throw forbidden();
}

export async function authorizeCompany(db: Db, session: Session, companyId: string, minRole: CompanyRole): Promise<CompanyRole> {
  if (!z.uuid().safeParse(companyId).success) return deny(db, session, companyId, minRole, 'invalid_id');
  if (session.realmRoles.includes('nett_admin')) return 'company_admin';
  const [row] = await db
    .select({ role: memberships.role, status: companies.status })
    .from(memberships)
    .innerJoin(companies, eq(companies.id, memberships.companyId))
    .where(and(eq(memberships.userId, session.user.id), eq(memberships.companyId, companyId)))
    .limit(1);
  if (!row) return deny(db, session, companyId, minRole, 'no_membership');
  if (row.status !== 'active') return deny(db, session, companyId, minRole, 'company_inactive');
  if (ROLE_RANK[row.role] < ROLE_RANK[minRole]) return deny(db, session, companyId, minRole, 'insufficient_role');
  return row.role;
}

export function requireRealmRole(session: Session, role: Session['realmRoles'][number]) {
  if (!session.realmRoles.includes(role) && !session.realmRoles.includes('nett_admin')) throw forbidden();
}
