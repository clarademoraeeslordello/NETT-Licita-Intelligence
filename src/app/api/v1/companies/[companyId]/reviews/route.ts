import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { requireCompanyAccess, requireSession, withApi } from '@/server/auth';
import { requestContext } from '@/server/http/request';
import { reviewInput } from '@/server/analysis/reviews/dto';
import { createReview, ReviewError } from '@/server/analysis/reviews/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 200_000;
const fail = (status: number, code: string, message: string, details?: unknown) => NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });

/**
 * POST /api/v1/companies/{companyId}/reviews — registra um HumanReview (append-only).
 * Papel mínimo: consultant. O revisor é o usuário da sessão; a empresa vem do caminho.
 */
export const POST = withApi(async (request: Request, ctx: { params: Promise<{ companyId: string }> }) => {
  const session = await requireSession();
  const { companyId } = await ctx.params;
  await requireCompanyAccess(session, companyId, 'consultant');

  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição grande demais.');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'INVALID_JSON', 'Corpo não é JSON válido.');
  }
  const parsed = reviewInput.safeParse(body);
  if (!parsed.success) return fail(422, 'VALIDATION', 'Dados inválidos.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));

  try {
    const created = await createReview(getDb(), { companyId, reviewerUserId: session.user.id, input: parsed.data, ctx: requestContext(request) });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof ReviewError) return fail(e.status, e.code, e.message);
    throw e;
  }
});
