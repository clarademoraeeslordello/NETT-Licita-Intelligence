import { getDb } from '@/server/db';
import { requireCompanyAccess, requireSession, withApi } from '@/server/auth';
import { reviewsHandlers } from '@/server/analysis/reviews/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/v1/companies/{companyId}/reviews
 *  POST — registra um HumanReview append-only (papel mínimo: consultant). O revisor é o usuário da sessão.
 *  GET  — lista os pareceres de um assunto, mais recentes primeiro (papel mínimo: viewer).
 */
const handlers = reviewsHandlers({ db: getDb, requireSession, authorize: requireCompanyAccess });

export const POST = withApi(handlers.POST);
export const GET = withApi(handlers.GET);
