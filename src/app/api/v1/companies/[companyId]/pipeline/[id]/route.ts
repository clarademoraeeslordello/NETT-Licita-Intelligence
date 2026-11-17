import { getDb } from '@/server/db';
import { requireCompanyAccess, requireSession, withApi } from '@/server/auth';
import { pipelineHandlers } from '@/server/pipeline/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** /api/v1/companies/{companyId}/pipeline/{id} — PATCH (consultant): etapa, valor, resultado, notas, descarte. */
const h = pipelineHandlers({ db: getDb, requireSession, authorize: requireCompanyAccess });
export const PATCH = withApi(h.patchPipeline);
