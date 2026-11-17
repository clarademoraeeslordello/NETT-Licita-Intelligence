import { getDb } from '@/server/db';
import { requireCompanyAccess, requireSession, withApi } from '@/server/auth';
import { pipelineHandlers } from '@/server/pipeline/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** /api/v1/companies/{companyId}/certificates — só metadados do cofre (CONTRACTS §2, linha Document). */
const h = pipelineHandlers({ db: getDb, requireSession, authorize: requireCompanyAccess });
export const GET = withApi(h.listCertificates);
export const POST = withApi(h.createCertificate);
