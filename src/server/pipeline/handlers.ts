/**
 * Handlers de /api/v1/companies/{cid}/pipeline e /certificates (T-406). Dependências injetadas (como em
 * `analysis/reviews/handlers.ts`) para testar sem cookies do Next. Erros viram `apiError` em `withApi` (ADR-022).
 */
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { uuid } from '@/contracts';
import type { CompanyRole } from '../auth/guard';
import type { Session } from '../auth/session';
import type { Db } from '../db';
import { HttpError, notFound, unprocessable } from '../http/errors';
import { requestContext } from '../http/request';
import { certificateCreateInput, certificateUpdateInput, trackingCreateInput, trackingListQuery, trackingUpdateInput } from './dto';
import { createCertificate, createTracking, listCertificates, listTrackings, updateCertificate, updateTracking } from './service';

export type PipelineDeps = {
  db: () => Db;
  requireSession: () => Promise<Session>;
  authorize: (session: Session, companyId: string, minRole: CompanyRole) => Promise<unknown>;
};
export type CompanyCtx = { params: Promise<{ companyId: string }> };
export type ItemCtx = { params: Promise<{ companyId: string; id: string }> };

export const MAX_BODY = 20_000;

const issues = (error: z.ZodError) => error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new HttpError('PAYLOAD_TOO_LARGE', 413, 'Corpo da requisição grande demais.');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError('INVALID_JSON', 400, 'Corpo não é JSON válido.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw unprocessable('Dados inválidos.', issues(parsed.error));
  return parsed.data;
}

const itemId = (id: string) => {
  if (!uuid.safeParse(id).success) throw notFound();
  return id;
};

export function pipelineHandlers(deps: PipelineDeps) {
  const actor = async (ctx: CompanyCtx, minRole: CompanyRole, request: Request) => {
    const session = await deps.requireSession();
    const { companyId } = await ctx.params;
    await deps.authorize(session, companyId, minRole);
    return { companyId, userId: session.user.id, ctx: requestContext(request) };
  };

  return {
    /** GET — viewer+. */
    async listPipeline(request: Request, ctx: CompanyCtx) {
      const a = await actor(ctx, 'viewer', request);
      const q = trackingListQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!q.success) throw unprocessable('Parâmetros inválidos.', issues(q.error));
      return NextResponse.json(await listTrackings(deps.db(), a.companyId, q.data));
    },
    /** POST — consultant+. */
    async createPipeline(request: Request, ctx: CompanyCtx) {
      const a = await actor(ctx, 'consultant', request);
      const body = await readBody(request, trackingCreateInput);
      const { tracking, reopened } = await createTracking(deps.db(), a, body);
      return NextResponse.json({ tracking, reopened }, { status: reopened ? 200 : 201 });
    },
    /** PATCH — consultant+. */
    async patchPipeline(request: Request, ctx: ItemCtx) {
      const a = await actor(ctx, 'consultant', request);
      const { id } = await ctx.params;
      const trackingId = itemId(id);
      const body = await readBody(request, trackingUpdateInput);
      return NextResponse.json({ tracking: await updateTracking(deps.db(), a, trackingId, body) });
    },
    /** GET — viewer+. */
    async listCertificates(request: Request, ctx: CompanyCtx) {
      const a = await actor(ctx, 'viewer', request);
      return NextResponse.json(await listCertificates(deps.db(), a.companyId));
    },
    /** POST — consultant+. */
    async createCertificate(request: Request, ctx: CompanyCtx) {
      const a = await actor(ctx, 'consultant', request);
      const body = await readBody(request, certificateCreateInput);
      return NextResponse.json({ certificate: await createCertificate(deps.db(), a, body) }, { status: 201 });
    },
    /** PATCH — consultant+. */
    async patchCertificate(request: Request, ctx: ItemCtx) {
      const a = await actor(ctx, 'consultant', request);
      const { id } = await ctx.params;
      const certId = itemId(id);
      const body = await readBody(request, certificateUpdateInput);
      return NextResponse.json({ certificate: await updateCertificate(deps.db(), a, certId, body) });
    },
  };
}
