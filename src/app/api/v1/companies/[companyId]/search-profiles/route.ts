import { withApi } from '@/server/auth';
import { handlers } from '@/server/profiles/wiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/v1/companies/{companyId}/search-profiles (T-216)
 *  GET  — lista os perfis da empresa (viewer).
 *  POST — cria (consultant); enfileira `match.profile` só se o perfil nasce ativo (guarda "sem perfil ativo").
 */
export const GET = withApi(handlers.listProfiles);
export const POST = withApi(handlers.createProfile);
