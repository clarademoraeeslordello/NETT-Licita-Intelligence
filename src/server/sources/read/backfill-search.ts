/**
 * Preenche/reconstrói `opportunity_search` (T-215). Uso:
 *   npm run search:backfill              # só as oportunidades sem linha
 *   npm run search:backfill -- --rebuild # recalcula todas (após mudar a normalização)
 * Usa DATABASE_URL (papel nett_app, DML apenas). Idempotente e retomável.
 */
import { closeDb, getDb } from '../../db';
import { backfillSearchIndex, missingSearchRows } from './search-index';

async function main() {
  const mode = process.argv.includes('--rebuild') ? 'rebuild' : 'missing';
  const db = getDb();
  const antes = await missingSearchRows(db);
  const r = await backfillSearchIndex(db, { mode });
  console.log(JSON.stringify({ evento: 'search.backfill', mode, semLinhaAntes: antes, ...r, semLinhaDepois: await missingSearchRows(db) }));
  await closeDb();
}

main().catch((e) => {
  console.error('[search:backfill]', e instanceof Error ? e.message : e);
  process.exit(1);
});
