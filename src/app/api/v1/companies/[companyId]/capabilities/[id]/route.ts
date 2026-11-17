import { withApi } from '@/server/auth';
import { handlers } from '@/server/profiles/wiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/v1/companies/{companyId}/capabilities/{id} (T-216)
 *  GET   — uma capacidade (viewer).
 *  PATCH — altera (consultant).
 */
export const GET = withApi(handlers.getCapability);
export const PATCH = withApi(handlers.patchCapability);
