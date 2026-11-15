import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { requireSession, withApi } from '@/server/auth';
import { listAccessibleCompanies } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me — usuário da sessão, papéis globais e empresas acessíveis. */
export const GET = withApi(async () => {
  const session = await requireSession();
  const companies = await listAccessibleCompanies(getDb(), session);
  return NextResponse.json({ user: session.user, realmRoles: session.realmRoles, expiresAt: session.expiresAt.toISOString(), companies });
});
