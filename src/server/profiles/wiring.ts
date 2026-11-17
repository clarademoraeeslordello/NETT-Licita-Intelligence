/** Ligação real (sessão, autorização, banco, fila) usada pelas `route.ts` de /search-profiles e /capabilities. */
import { requireCompanyAccess, requireSession } from '../auth';
import { getDb } from '../db';
import { enqueue } from '../jobs/enqueue';
import { profilesHandlers } from './handlers';

export const handlers = profilesHandlers({
  db: getDb,
  requireSession,
  authorize: requireCompanyAccess,
  enqueueProfile: (searchProfileId) => enqueue('match.profile', { searchProfileId }),
});
