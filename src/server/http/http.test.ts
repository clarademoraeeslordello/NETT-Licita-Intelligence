/** Unidade T-107/T-108. Executar: npm run test:http */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCsp } from '../../middleware';
import { sanitizeMetadata } from '../audit';
import { clientIp, hashIdentifier } from './client-ip';

test('CSP de produção: nonce, sem unsafe-inline/eval em script, sem frame', () => {
  const csp = buildCsp('abc', { dev: false, formActionOrigins: ['https://sso.nett.test'] });
  assert.match(csp, /script-src 'self' 'nonce-abc' 'strict-dynamic'(;|$)/);
  assert.doesNotMatch(csp.split('; ').find((d) => d.startsWith('script-src'))!, /unsafe/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /form-action 'self' https:\/\/sso\.nett\.test/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.match(buildCsp('n', { dev: true, formActionOrigins: [] }), /'unsafe-eval'/);
  assert.match(buildCsp('n', { dev: false, formActionOrigins: [], legacyInline: true }), /script-src 'self' 'unsafe-inline'/);
});

test('IP do cliente: usa a entrada adicionada pelo proxy confiável, ignora forjada à esquerda', () => {
  const h = (v: string) => new Headers({ 'x-forwarded-for': v });
  assert.equal(clientIp(h('6.6.6.6, 200.1.2.3'), 1), '200.1.2.3');
  assert.equal(clientIp(h('200.1.2.3'), 1), '200.1.2.3');
  assert.equal(clientIp(h('1.1.1.1, 2.2.2.2, 3.3.3.3'), 2), '2.2.2.2');
  assert.equal(clientIp(new Headers(), 1), null);
  assert.equal(clientIp(h('<script>'), 1), null);
});

test('hash de identificador: estável, não reversível trivialmente, exige segredo', () => {
  const s = 'z'.repeat(40);
  assert.equal(hashIdentifier('200.1.2.3', s), hashIdentifier('200.1.2.3', s));
  assert.notEqual(hashIdentifier('200.1.2.3', s), hashIdentifier('200.1.2.4', s));
  assert.doesNotMatch(hashIdentifier('200.1.2.3', s), /200/);
  assert.throws(() => hashIdentifier('x', 'curto'));
});

test('metadata de auditoria: remove chaves sensíveis e limita tamanho', () => {
  const out = sanitizeMetadata({
    password: 'x', accessToken: 'y', nested: { Authorization: 'z', ok: 1, cpf: '123' }, longo: 'a'.repeat(900), lista: Array(80).fill(1),
  }) as Record<string, any>;
  assert.equal(out.password, '[removido]');
  assert.equal(out.accessToken, '[removido]');
  assert.equal(out.nested.Authorization, '[removido]');
  assert.equal(out.nested.cpf, '[removido]');
  assert.equal(out.nested.ok, 1);
  assert.ok(out.longo.length <= 501);
  assert.equal(out.lista.length, 50);
});
