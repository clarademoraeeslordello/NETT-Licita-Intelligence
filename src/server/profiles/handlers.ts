/**
 * Handlers de /api/v1/companies/{cid}/search-profiles e /capabilities (T-216). As dependências são injetadas para
 * rodar nos testes sem cookies do Next; as `route.ts` ligam sessão, autorização, banco e fila reais.
 * Erros de `requireSession`/`authorize` (AuthError) e `HttpError` são convertidos por `withApi` na rota.
 * Papéis (CONTRACTS §4): GET = viewer; POST e PATCH = consultant.
 */
import { NextResponse } from 'next/server';
import { badRequest, HttpError, notFound, unprocessable } from '../http/errors';
import type { CompanyRole } from '../auth/guard';
import type { Session } from '../auth/session';
import type { Db } from '../db';
import { requestContext } from '../http/request';
import { capabilityCreate, capabilityPatch, idParam, listQuery, MAX_BODY, searchProfileCreate, searchProfilePatch } from './dto';
import { createCapability, createSearchProfile, getCapability, getSearchProfile, listCapabilities, listSearchProfiles, updateCapability, updateSearchProfile, type EnqueueProfile } from './service';

export type ProfilesDeps = {
  db: () => Db;
  requireSession: () => Promise<Session>;
  authorize: (session: Session, companyId: string, minRole: CompanyRole) => Promise<unknown>;
  /** Enfileira `match.profile { searchProfileId }`. */
  enqueueProfile: EnqueueProfile;
};

export type CollectionCtx = { params: Promise<{ companyId: string }> };
export type ItemCtx = { params: Promise<{ companyId: string; id: string }> };

const issues = (error: { issues: { path: PropertyKey[]; message: string }[] }) => error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message }));

async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY) throw new HttpError('PAYLOAD_TOO_LARGE', 413, 'Corpo da requisição grande demais.');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new HttpError('PAYLOAD_TOO_LARGE', 413, 'Corpo da requisição grande demais.');
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('Corpo não é JSON válido.');
  }
}

const parseOr422 = <T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown, what: string): T => {
  const r = schema.safeParse(value);
  if (!r.success) throw unprocessable(what, issues(r.error));
  return r.data;
};

export function profilesHandlers(deps: ProfilesDeps) {
  const guard = async (ctx: { params: Promise<{ companyId: string }> }, minRole: CompanyRole) => {
    const session = await deps.requireSession();
    const { companyId } = await ctx.params;
    await deps.authorize(session, companyId, minRole);
    return { session, companyId };
  };
  const itemId = (id: string) => {
    const r = idParam.safeParse(id);
    if (!r.success) throw notFound(); // id malformado = inexistente
    return r.data;
  };
  const query = (request: Request) => parseOr422(listQuery, Object.fromEntries(new URL(request.url).searchParams), 'Parâmetros inválidos.');

  return {
    /* ----------------------------- search-profiles ----------------------------- */
    listProfiles: async (request: Request, ctx: CollectionCtx): Promise<Response> => {
      const { companyId } = await guard(ctx, 'viewer');
      const q = query(request); // valida antes de abrir o banco
      return NextResponse.json(await listSearchProfiles(deps.db(), companyId, q));
    },
    getProfile: async (_request: Request, ctx: ItemCtx): Promise<Response> => {
      const { companyId } = await guard(ctx, 'viewer');
      const id = itemId((await ctx.params).id);
      return NextResponse.json(await getSearchProfile(deps.db(), companyId, id));
    },
    createProfile: async (request: Request, ctx: CollectionCtx): Promise<Response> => {
      const { session, companyId } = await guard(ctx, 'consultant');
      const input = parseOr422(searchProfileCreate, await readJson(request), 'Dados inválidos.');
      const r = await createSearchProfile(deps.db(), deps.enqueueProfile, { companyId, actorUserId: session.user.id, input, ctx: requestContext(request) });
      return NextResponse.json(r, { status: 201 });
    },
    patchProfile: async (request: Request, ctx: ItemCtx): Promise<Response> => {
      const { session, companyId } = await guard(ctx, 'consultant');
      const id = itemId((await ctx.params).id);
      const patch = parseOr422(searchProfilePatch, await readJson(request), 'Dados inválidos.');
      const r = await updateSearchProfile(deps.db(), deps.enqueueProfile, { companyId, id, actorUserId: session.user.id, patch, ctx: requestContext(request) });
      return NextResponse.json(r);
    },

    /* ------------------------------- capabilities ------------------------------ */
    listCapabilities: async (request: Request, ctx: CollectionCtx): Promise<Response> => {
      const { companyId } = await guard(ctx, 'viewer');
      const q = query(request);
      return NextResponse.json(await listCapabilities(deps.db(), companyId, q));
    },
    getCapability: async (_request: Request, ctx: ItemCtx): Promise<Response> => {
      const { companyId } = await guard(ctx, 'viewer');
      const id = itemId((await ctx.params).id);
      return NextResponse.json(await getCapability(deps.db(), companyId, id));
    },
    createCapability: async (request: Request, ctx: CollectionCtx): Promise<Response> => {
      const { session, companyId } = await guard(ctx, 'consultant');
      const input = parseOr422(capabilityCreate, await readJson(request), 'Dados inválidos.');
      return NextResponse.json(await createCapability(deps.db(), { companyId, actorUserId: session.user.id, input, ctx: requestContext(request) }), { status: 201 });
    },
    patchCapability: async (request: Request, ctx: ItemCtx): Promise<Response> => {
      const { session, companyId } = await guard(ctx, 'consultant');
      const id = itemId((await ctx.params).id);
      const patch = parseOr422(capabilityPatch, await readJson(request), 'Dados inválidos.');
      return NextResponse.json(await updateCapability(deps.db(), { companyId, id, actorUserId: session.user.id, patch, ctx: requestContext(request) }));
    },
  };
}
