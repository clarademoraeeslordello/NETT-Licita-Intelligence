import { withApi } from '@/server/auth';
import { handlers } from '@/server/profiles/wiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/v1/companies/{companyId}/search-profiles/{id} (T-216)
 *  GET   — um perfil (viewer).
 *  PATCH — altera (consultant); reprocessa (`match.profile`) só se o perfil ficou ativo e algo do match mudou.
 */
export const GET = withApi(handlers.getProfile);
export const PATCH = withApi(handlers.patchProfile);
