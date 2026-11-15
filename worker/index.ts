/** Entrada do serviço worker (Railway `worker`). Ver src/server/jobs/runner.ts. */
import { buildRegistry } from '../src/server/jobs/handlers';
import { startWorker } from '../src/server/jobs/runner';

async function main() {
  const handle = await startWorker(buildRegistry(), { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) });
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      handle.stop().then(
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
