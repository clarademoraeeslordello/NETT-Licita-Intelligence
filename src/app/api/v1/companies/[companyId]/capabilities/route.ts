import { withApi } from '@/server/auth';
import { handlers } from '@/server/profiles/wiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/v1/companies/{companyId}/capabilities (T-216)
 *  GET  — lista as capacidades da empresa (viewer).
 *  POST — cadastra (consultant).
 */
export const GET = withApi(handlers.listCapabilities);
export const POST = withApi(handlers.createCapability);
