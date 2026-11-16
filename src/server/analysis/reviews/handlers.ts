/**
 * Handlers of /api/v1/companies/{cid}/reviews (T-304). Dependencies are injected so the handlers run
 * in tests without Next.js cookies; `route.ts` wires the real session, authorization and database.
 * Errors thrown by `requireSession` / `authorize` (AuthError) are mapped by `withApi` in the route.
 */
import { NextResponse } from 'next/server';
import { reviewInput, reviewListQuery } from '@/contracts/api/reviews';
import type { CompanyRole } from '../../auth/guard';
import type { Session } from '../../auth/session';
import type { Db } from '../../db';
import { requestContext } from '../../http/request';
import { createReview, decodeCursor, listReviews, ReviewError } from './service';

export type ReviewsDeps = {
  db: () => Db;
  requireSession: () => Promise<Session>;
  authorize: (session: Session, companyId: string, minRole: CompanyRole) => Promise<unknown>;
};

export type RouteCtx = { params: Promise<{ companyId: string }> };

export const MAX_BODY = 200_000;
const fail = (status: number, code: string, message: string, details?: unknown) =>
  NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });

const issues = (error: { issues: { path: PropertyKey[]; message: string }[] }) => error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

export function reviewsHandlers(deps: ReviewsDeps) {
  /** POST — consultant+: records a HumanReview. */
  const POST = async (request: Request, ctx: RouteCtx): Promise<Response> => {
    const session = await deps.requireSession();
    const { companyId } = await ctx.params;
    await deps.authorize(session, companyId, 'consultant');

    const raw = await request.text();
    if (raw.length > MAX_BODY) return fail(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição grande demais.');
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(400, 'INVALID_JSON', 'Corpo não é JSON válido.');
    }
    const parsed = reviewInput.safeParse(body);
    if (!parsed.success) return fail(422, 'VALIDATION', 'Dados inválidos.', issues(parsed.error));

    try {
      const created = await createReview(deps.db(), { companyId, reviewerUserId: session.user.id, input: parsed.data, ctx: requestContext(request) });
      return NextResponse.json(created, { status: 201 });
    } catch (e) {
      if (e instanceof ReviewError) return fail(e.status, e.code, e.message);
      throw e;
    }
  };

  /** GET — viewer+: reviews of one subject, newest first, cursor pagination. */
  const GET = async (request: Request, ctx: RouteCtx): Promise<Response> => {
    const session = await deps.requireSession();
    const { companyId } = await ctx.params;
    await deps.authorize(session, companyId, 'viewer');

    const parsed = reviewListQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return fail(422, 'VALIDATION', 'Parâmetros inválidos.', issues(parsed.error));
    try {
      if (parsed.data.cursor) decodeCursor(parsed.data.cursor); // reject before touching the database
      return NextResponse.json(await listReviews(deps.db(), companyId, parsed.data));
    } catch (e) {
      if (e instanceof ReviewError) return fail(e.status, e.code, e.message);
      throw e;
    }
  };

  return { POST, GET };
}
