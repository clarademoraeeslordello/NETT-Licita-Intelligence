/**
 * T-105 — integração com Postgres real. Requer banco descartável já migrado e:
 *   DATABASE_URL_MIGRATOR  (instala o schema pgboss — mesmo banco do teste)
 *   DATABASE_URL_TEST      (papel nett_app)
 * Executar: npm run test:jobs
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { PgBoss } from 'pg-boss';
import { createBoss } from './boss';
import { enqueueWith, InvalidJobPayload, stableKey } from './enqueue';
import { ensureQueues, jobNames } from './queues';
import { JobRegistry } from './registry';
import { startWorker, type WorkerHandle } from './runner';
import { setupJobs } from './setup';

const appUrl = process.env.DATABASE_URL_TEST;
const migratorUrl = process.env.DATABASE_URL_MIGRATOR;
if (!appUrl || !migratorUrl) throw new Error('DATABASE_URL_TEST e DATABASE_URL_MIGRATOR são obrigatórias');

let boss: PgBoss;
const run = Date.now().toString(36);

const waitFor = async (check: () => Promise<boolean>, ms = 20_000) => {
  const limit = Date.now() + ms;
  while (Date.now() < limit) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('tempo esgotado aguardando condição');
};

before(async () => {
  await setupJobs(migratorUrl);
  await setupJobs(migratorUrl); // idempotente
  boss = createBoss(appUrl);
  await boss.start();
});

after(async () => {
  await ensureQueues(boss); // restaura retryDelay/backoff alterados no teste de retentativa
  await boss.stop({ graceful: false });
});

test('todas as filas do contrato existem com política stately e retryLimit 3', async () => {
  for (const name of jobNames) {
    const q = await boss.getQueue(name);
    assert.ok(q, `fila ${name} ausente`);
    assert.equal(q.policy, 'stately');
    assert.equal(q.retryLimit, 3);
  }
});

test('enqueue valida o payload pelo contrato', async () => {
  await assert.rejects(() => enqueueWith(boss, 'source.normalize', { sourceRecordId: 'nao-uuid' } as never), InvalidJobPayload);
  await assert.rejects(() => enqueueWith(boss, 'source.sync', { sourceKey: 'pncp', mode: 'tudo' } as never), InvalidJobPayload);
});

test('enqueue é idempotente: mesmo payload na fila → mesmo job', async () => {
  const payload = { sourceKey: `idem_${run}`, mode: 'incremental' as const };
  const a = await enqueueWith(boss, 'source.sync', payload);
  const b = await enqueueWith(boss, 'source.sync', { mode: 'incremental', sourceKey: `idem_${run}` });
  assert.equal(a, b);
  const jobs = await boss.findJobs('source.sync', { key: stableKey(payload) });
  assert.equal(jobs.length, 1);
  await boss.cancel('source.sync', a);
});

test('worker processa o job, aplica retentativa e conclui (handler executado uma vez com sucesso)', async () => {
  await boss.updateQueue('source.sync', { retryDelay: 1, retryBackoff: false });
  const execucoes: Array<{ retry: number; ok: boolean }> = [];
  const registry = new JobRegistry().register('source.sync', async (payload, ctx) => {
    if (payload.sourceKey !== `proc_${run}`) return;
    const falhar = ctx.retryCount === 0;
    execucoes.push({ retry: ctx.retryCount, ok: !falhar });
    if (falhar) throw new Error('falha transitória simulada');
  });
  let worker: WorkerHandle | null = null;
  try {
    worker = await startWorker(registry, { connectionString: appUrl, pollingIntervalSeconds: 0.5 });
    const id = await enqueueWith(boss, 'source.sync', { sourceKey: `proc_${run}`, mode: 'backfill' });
    await waitFor(async () => (await boss.findJobs('source.sync', { id }))[0]?.state === 'completed');
    const [job] = await boss.findJobs('source.sync', { id });
    assert.equal(job!.retryCount, 1);
    assert.deepEqual(execucoes, [
      { retry: 0, ok: false },
      { retry: 1, ok: true },
    ]);
    // Concluído: novo enqueue do mesmo trabalho cria um job novo (sem bloquear sincronizações futuras).
    const novo = await enqueueWith(boss, 'source.sync', { sourceKey: `proc_${run}`, mode: 'backfill' });
    assert.notEqual(novo, id);
    await waitFor(async () => (await boss.findJobs('source.sync', { id: novo }))[0]?.state === 'completed');
  } finally {
    await worker?.stop();
  }
});

test('worker recusa iniciar sem o schema/filas instalados para o handler', async () => {
  const registry = new JobRegistry().register('document.fetch', async () => {});
  await boss.deleteQueue('document.fetch');
  try {
    await assert.rejects(() => startWorker(registry, { connectionString: appUrl }), /filas ausentes/);
  } finally {
    await setupJobs(migratorUrl);
  }
});
