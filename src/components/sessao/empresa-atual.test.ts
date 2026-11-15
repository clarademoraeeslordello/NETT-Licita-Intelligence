import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caminhoDeRetorno, escolherEmpresa, ordenarEmpresas, urlDeLogin, type EmpresaAcessivel } from './empresa-atual';

const A: EmpresaAcessivel = { id: '11111111-1111-4111-8111-111111111111', legalName: 'Beta Ltda', role: 'consultant' };
const B: EmpresaAcessivel = { id: '22222222-2222-4222-8222-222222222222', legalName: 'Alfa S.A.', role: 'viewer' };

test('sem empresas acessíveis: nenhuma ativa', () => {
  assert.equal(escolherEmpresa([], A.id), null);
});

test('cookie com empresa acessível é respeitado', () => {
  assert.equal(escolherEmpresa([A, B], A.id), A);
});

test('cookie ausente, forjado ou de empresa sem acesso: primeira em ordem alfabética', () => {
  assert.equal(escolherEmpresa([A, B], undefined), B);
  assert.equal(escolherEmpresa([A, B], '33333333-3333-4333-8333-333333333333'), B);
  assert.equal(escolherEmpresa([A, B], "'; drop table companies; --"), B);
});

test('ordenação por razão social em pt-BR não altera a lista original', () => {
  const lista = [A, B];
  assert.deepEqual(ordenarEmpresas(lista).map((e) => e.legalName), ['Alfa S.A.', 'Beta Ltda']);
  assert.deepEqual(lista, [A, B]);
});

test('retorno do login só aceita caminho interno', () => {
  assert.equal(caminhoDeRetorno('/radar', '?q=1'), '/radar?q=1');
  assert.equal(caminhoDeRetorno('//evil.test', ''), '/');
  assert.equal(caminhoDeRetorno('https://evil.test', ''), '/');
  assert.equal(caminhoDeRetorno(null, null), '/');
  assert.equal(urlDeLogin('/radar?q=1'), '/api/auth/login?returnTo=%2Fradar%3Fq%3D1');
});
