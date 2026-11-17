import { requireCompanyAccess, requireSession, withApi } from '@/server/auth';
import { getDb } from '@/server/db';
import { radarHandlers } from '@/server/matching/radar/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/companies/{companyId}/radar (T-217, viewer) — oportunidades com a melhor nota da empresa,
 * ordenadas por nota, com filtros (uf, modalidade, situação efetiva, nota mínima, prazo, categoria, perfil, q) e cursor.
 */
export const GET = withApi(radarHandlers({ db: getDb, requireSession, authorize: requireCompanyAccess }).GET);
