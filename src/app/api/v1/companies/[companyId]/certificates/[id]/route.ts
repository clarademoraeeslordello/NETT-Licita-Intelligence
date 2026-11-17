import { getDb } from '@/server/db';
import { requireCompanyAccess, requireSession, withApi } from '@/server/auth';
import { pipelineHandlers } from '@/server/pipeline/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** /api/v1/companies/{companyId}/certificates/{id} — PATCH (consultant): renovar datas, corrigir metadados. */
const h = pipelineHandlers({ db: getDb, requireSession, authorize: requireCompanyAccess });
export const PATCH = withApi(h.patchCertificate);
