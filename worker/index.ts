/** Entrada do serviço worker (Railway `worker`). Ver src/server/jobs/runner.ts. */
import { getDb } from '../src/server/db';
import { buildRegistry, sourceSchedules } from '../src/server/jobs/handlers';
import { matchSchedules } from '../src/server/matching';
import { startWorker } from '../src/server/jobs/runner';

async function main() {
  // Espaçamento mínimo entre chamadas ao PNCP neste processo (respeito ao limite da fonte).
  process.env.PNCP_MIN_INTERVAL_MS ??= '1000';
  const pool = getDb().$client;
  const handle = await startWorker((boss) => buildRegistry({ pool, boss }), {
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
    schedules: [...sourceSchedules(), ...matchSchedules()],
  });
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      handle
        .stop()
        .then(() => pool.end())
        .then(
          () => process.exit(0),
          (e) => {
            console.error('[worker] falha ao encerrar', e);
            process.exit(1);
          },
        );
    });
  }
}

main().catch((e) => {
  console.error('[worker]', e instanceof Error ? e.message : e);
  process.exit(1);
});
