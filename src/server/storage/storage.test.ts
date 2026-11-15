/** T-106 — unidade (sem servidor S3): formato de chave, TTL e assinatura. `npm run test:storage` */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertValidKey, companyKey, InvalidStorageKey, publicKey, S3ObjectStorage, s3ConfigFromEnv, sha256Hex } from './index';

const OPP = '0b7f9d1e-2c3a-4b5d-8e6f-7a8b9c0d1e2f';
const CO = '1c8e0a2f-3d4b-4c6e-9f70-8b9cad0e1f30';
const H = 'a'.repeat(64);

test('aceita somente as chaves do contrato', () => {
  assert.equal(publicKey(OPP, H, 'PDF'), `public/${OPP}/${H}.pdf`);
  assert.equal(companyKey(CO, OPP, '.pdf'), `companies/${CO}/${OPP}.pdf`);
  for (const ruim of [
    `public/${OPP}/../companies/${CO}/x.pdf`,
    `/public/${OPP}/${H}.pdf`,
    `public/${OPP}/${H}.pdf/../../x`,
    `companies/${CO}/../../public/${OPP}/${H}`,
    `outros/${OPP}/${H}.pdf`,
    `public/nao-uuid/${H}.pdf`,
    `public/${OPP}/${H}.pdf\n`,
  ]) {
    assert.throws(() => assertValidKey(ruim), InvalidStorageKey, ruim);
  }
});

test('hash sha256 em hex', () => {
  assert.equal(sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('URL assinada: TTL limitado a 600 s e assinatura SigV4 sem expor o segredo', async () => {
  const storage = new S3ObjectStorage({ endpoint: 'http://localhost:8333', region: 'us-east-1', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'SEGREDO', forcePathStyle: true });
  const url = new URL(await storage.signedUrl(`public/${OPP}/${H}.pdf`, 600));
  assert.equal(url.pathname, `/b/public/${OPP}/${H}.pdf`);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
  assert.match(url.searchParams.get('X-Amz-Signature') ?? '', /^[a-f0-9]{64}$/);
  assert.ok(!url.toString().includes('SEGREDO'));
  await assert.rejects(() => storage.signedUrl(`public/${OPP}/${H}.pdf`, 601), RangeError);
  await assert.rejects(() => storage.signedUrl(`public/${OPP}/${H}.pdf`, 0), RangeError);
  await assert.rejects(() => storage.signedUrl('qualquer', 60), InvalidStorageKey);
});

test('configuração exige bucket e credenciais', () => {
  assert.throws(() => s3ConfigFromEnv({}), /S3_BUCKET/);
  const c = s3ConfigFromEnv({ S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' });
  assert.equal(c.forcePathStyle, true);
  assert.equal(c.endpoint, undefined);
});
