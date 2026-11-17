/**
 * Handler de GET /api/v1/companies/{cid}/radar (T-217). Papel mínimo: viewer. Dependências injetadas para testar
 * sem cookies do Next; `route.ts` liga sessão, autorização e banco reais. `withApi` converte AuthError/HttpError.
 */
import { NextResponse } from 'next/server';
import type { CompanyRole } from '../../auth/guard';
import type { Session } from '../../auth/session';
import type { Db } from '../../db';
import { parseQuery } from '../../sources/read/http';
import { radarQuery } from './dto';
import { listRadar } from './service';

export type RadarDeps = {
  db: () => Db;
  requireSession: () => Promise<Session>;
  authorize: (session: Session, companyId: string, minRole: CompanyRole) => Promise<unknown>;
  now?: () => Date;
};

export type RadarCtx = { params: Promise<{ companyId: string }> };

export function radarHandlers(deps: RadarDeps) {
  return {
    GET: async (request: Request, ctx: RadarCtx): Promise<Response> => {
      const session = await deps.requireSession();
      const { companyId } = await ctx.params;
      await deps.authorize(session, companyId, 'viewer');
      const q = parseQuery(radarQuery, new URL(request.url).searchParams); // valida antes de abrir o banco
      return NextResponse.json(await listRadar(deps.db(), companyId, q, deps.now?.() ?? new Date()));
    },
  };
}
