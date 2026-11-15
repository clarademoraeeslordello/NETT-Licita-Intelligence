/**
 * T-106 — integração com o S3 local (SeaweedFS do docker-compose, ADR-015).
 *   npm run infra:up   (sobe storage em :8333 e cria o bucket nett-licita)
 *   S3_* do .env.example
 *   npm run test:storage:integration
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { companyKey, ObjectNotFound, publicKey, S3ObjectStorage, s3ConfigFromEnv, sha256Hex } from './index';

const config = s3ConfigFromEnv();
const storage = new S3ObjectStorage(config);
const corpo = new TextEncoder().encode(`%PDF-1.4 teste ${randomUUID()}`);
const opp = randomUUID();
const key = publicKey(opp, sha256Hex(corpo), 'pdf');

test('put/get preservam conteúdo e devolvem sha256 e tamanho', async () => {
  const r = await storage.put(key, corpo, 'application/pdf');
  assert.deepEqual(r, { sha256: sha256Hex(corpo), sizeBytes: corpo.byteLength });
  assert.deepEqual(await storage.get(key), corpo);
});

test('objeto inexistente vira ObjectNotFound', async () => {
  await assert.rejects(() => storage.get(companyKey(randomUUID(), randomUUID(), 'pdf')), ObjectNotFound);
});

test('URL assinada baixa o objeto; acesso anônimo é negado', async () => {
  const url = await storage.signedUrl(key, 60);
  const ok = await fetch(url);
  assert.equal(ok.status, 200);
  assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), corpo);
  const anonimo = await fetch(`${config.endpoint}/${config.bucket}/${key}`);
  assert.equal(anonimo.status, 403);
  await anonimo.body?.cancel();
});

test('URL assinada adulterada é rejeitada', async () => {
  const url = new URL(await storage.signedUrl(key, 60));
  url.searchParams.set('X-Amz-Expires', '600');
  const r = await fetch(url);
  assert.equal(r.status, 403);
  await r.body?.cancel();
});

test('URL assinada expira', async () => {
  const url = await storage.signedUrl(key, 1);
  await new Promise((r) => setTimeout(r, 2_500));
  const r = await fetch(url);
  assert.equal(r.status, 403);
  await r.body?.cancel();
});
