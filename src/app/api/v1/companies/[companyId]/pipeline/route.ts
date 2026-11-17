import { getDb } from '@/server/db';
import { requireCompanyAccess, requireSession, withApi } from '@/server/auth';
import { pipelineHandlers } from '@/server/pipeline/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** /api/v1/companies/{companyId}/pipeline — GET (viewer) lista; POST (consultant) adiciona à triagem. */
const h = pipelineHandlers({ db: getDb, requireSession, authorize: requireCompanyAccess });
export const GET = withApi(h.listPipeline);
export const POST = withApi(h.createPipeline);
