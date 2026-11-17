/**
 * T-203 — unidade (sem rede, sem banco): SSRF, limites, redirecionamento, 429 e tipo por conteúdo.
 *   npm run test:documents
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DocumentRateLimited,
  DocumentRejected,
  DocumentTransient,
  downloadDocument,
  isPrivateAddress,
  sniffDocument,
  type DownloadDeps,
} from './download';

const PDF = new TextEncoder().encode('%PDF-1.7\n%conteudo de teste\n');
const URL_OK = 'https://pncp.gov.br/pncp-api/v1/orgaos/12345678000190/compras/2026/1/arquivos/1';
const publico = async () => ['200.100.50.25'];
const semEspera = async () => {};

type Resp = { status: number; body?: Uint8Array | null; headers?: Record<string, string> };
function simulado(respostas: Resp[]) {
  const chamadas: string[] = [];
  const f = (async (url: string | URL | Request) => {
    chamadas.push(String(url));
    const r = respostas[Math.min(chamadas.length - 1, respostas.length - 1)]!;
    return new Response((r.body === undefined ? PDF : r.body) as BodyInit | null, { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { chamadas, deps: { fetch: f, lookup: publico, throttle: semEspera } satisfies DownloadDeps };
}
const rejeita = (promessa: Promise<unknown>, reason: string) =>
  assert.rejects(promessa, (e) => e instanceof DocumentRejected && e.reason === reason, `esperava rejeição ${reason}`);

test('endereços não públicos são reconhecidos (IPv4, IPv6 e IPv4 mapeado)', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', 'nao-e-ip']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['200.100.50.25', '8.8.8.8', '172.32.0.1', '172.15.255.255', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('SSRF: só HTTPS do PNCP; outros hosts, esquemas e IPs nunca são chamados', async () => {
  for (const url of [
    'http://pncp.gov.br/x.pdf',
    'https://pncp.gov.br.evil.test/x.pdf',
    'https://evil.test/pncp.gov.br/x.pdf',
    'https://169.254.169.254/latest/meta-data',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'file:///etc/passwd',
    'ftp://pncp.gov.br/x',
    'nao-e-url',
  ]) {
    const s = simulado([{ status: 200 }]);
    await rejeita(downloadDocument(url, s.deps), 'url_not_allowed');
    assert.equal(s.chamadas.length, 0, `não pode chamar ${url}`);
  }
});

test('SSRF: nome do PNCP que resolve para endereço privado (ou misto) é rejeitado antes de conectar', async () => {
  for (const enderecos of [['10.1.2.3'], ['169.254.169.254'], ['::1'], ['200.100.50.25', '127.0.0.1'], []]) {
    const s = simulado([{ status: 200 }]);
    await rejeita(downloadDocument(URL_OK, { ...s.deps, lookup: async () => enderecos }), 'private_address');
    assert.equal(s.chamadas.length, 0);
  }
});

test('falha de DNS é passageira (o pg-boss retenta)', async () => {
  const s = simulado([{ status: 200 }]);
  await assert.rejects(downloadDocument(URL_OK, { ...s.deps, lookup: async () => Promise.reject(new Error('ENOTFOUND')) }), DocumentTransient);
});

test('baixa o documento válido e devolve os bytes', async () => {
  const s = simulado([{ status: 200 }]);
  const r = await downloadDocument(URL_OK, s.deps);
  assert.deepEqual(r.bytes, PDF);
  assert.equal(r.finalUrl, URL_OK);
});

test('redirecionamento: segue dentro do PNCP, revalida cada salto e limita a 3', async () => {
  const ok = simulado([{ status: 302, headers: { location: '/outro/caminho.pdf' } }, { status: 200 }]);
  const r = await downloadDocument(URL_OK, ok.deps);
  assert.equal(r.finalUrl, 'https://pncp.gov.br/outro/caminho.pdf');
  assert.equal(ok.chamadas.length, 2);

  // Redirecionamento para fora do PNCP / para metadados de nuvem: bloqueado SEM seguir.
  for (const destino of ['https://evil.test/x.pdf', 'http://pncp.gov.br/x.pdf', 'https://169.254.169.254/latest', 'https://pncp.gov.br.evil.test/a']) {
    const s = simulado([{ status: 301, headers: { location: destino } }, { status: 200 }]);
    await rejeita(downloadDocument(URL_OK, s.deps), 'url_not_allowed');
    assert.equal(s.chamadas.length, 1, `não pode seguir para ${destino}`);
  }
  // Salto que resolve para endereço privado no 2º host.
  let n = 0;
  const privadoNoSalto = simulado([{ status: 302, headers: { location: 'https://interno.pncp.gov.br/x.pdf' } }, { status: 200 }]);
  await rejeita(downloadDocument(URL_OK, { ...privadoNoSalto.deps, lookup: async (h) => (n++, h === 'interno.pncp.gov.br' ? ['10.0.0.9'] : ['200.100.50.25']) }), 'private_address');
  assert.equal(privadoNoSalto.chamadas.length, 1);

  const laco = simulado([{ status: 302, headers: { location: '/de-novo' } }]);
  await rejeita(downloadDocument(URL_OK, laco.deps), 'too_many_redirects');
  assert.equal(laco.chamadas.length, 4); // 1 + 3 saltos
  await rejeita(downloadDocument(URL_OK, simulado([{ status: 302 }]).deps), 'bad_status'); // sem Location
});

test('limite de tamanho: pelo cabeçalho e pela leitura em fluxo (sem confiar no Content-Length)', async () => {
  const grande = new Uint8Array(2048).fill(0x41);
  const pelaLeitura = simulado([{ status: 200, body: grande }]);
  await rejeita(downloadDocument(URL_OK, { ...pelaLeitura.deps, maxBytes: 1024 }), 'too_large');
  const noLimite = simulado([{ status: 200, body: grande }]);
  assert.equal((await downloadDocument(URL_OK, { ...noLimite.deps, maxBytes: 2048 })).bytes.byteLength, 2048);

  const mentiroso = simulado([{ status: 200, body: grande, headers: { 'content-length': '10' } }]);
  await rejeita(downloadDocument(URL_OK, { ...mentiroso.deps, maxBytes: 1024 }), 'too_large'); // cabeçalho mente, a leitura limita
  const declarado = simulado([{ status: 200, body: PDF, headers: { 'content-length': '999999999' } }]);
  await rejeita(downloadDocument(URL_OK, { ...declarado.deps, maxBytes: 1024 }), 'too_large');
});

test('status HTTP: 404/403/410 e demais 4xx rejeitam; 5xx e rede falham de forma passageira; 429 nunca é retentado', async () => {
  for (const status of [404, 403, 410]) await rejeita(downloadDocument(URL_OK, simulado([{ status, body: null }]).deps), 'not_found');
  await rejeita(downloadDocument(URL_OK, simulado([{ status: 400, body: null }]).deps), 'bad_status');
  for (const status of [500, 502, 503]) await assert.rejects(downloadDocument(URL_OK, simulado([{ status, body: null }]).deps), DocumentTransient);
  const rede = { fetch: (async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch, lookup: publico, throttle: semEspera };
  await assert.rejects(downloadDocument(URL_OK, rede), DocumentTransient);

  const s = simulado([{ status: 429, body: null }, { status: 200 }]);
  await assert.rejects(downloadDocument(URL_OK, s.deps), (e) => e instanceof DocumentRateLimited && e.cooldownMs >= 60_000);
  assert.equal(s.chamadas.length, 1, 'o 429 não pode ser retentado');
});

test('respeita o espaçamento entre requisições (throttle chamado a cada salto)', async () => {
  let esperas = 0;
  const s = simulado([{ status: 302, headers: { location: '/b.pdf' } }, { status: 200 }]);
  await downloadDocument(URL_OK, { ...s.deps, throttle: async () => void (esperas += 1) });
  assert.equal(esperas, 2);
});

test('tipo pelo CONTEÚDO: PDF, Office, ZIP e texto passam; HTML de erro, executável e lixo não', () => {
  assert.deepEqual(sniffDocument(PDF, 'edital.pdf'), { mime: 'application/pdf', ext: 'pdf', extractable: true });
  assert.equal(sniffDocument(PDF, 'sem-extensao')?.mime, 'application/pdf'); // título não decide quando o conteúdo é PDF
  assert.equal(sniffDocument(new Uint8Array([0xef, 0xbb, 0xbf, ...PDF]), 'x')?.ext, 'pdf'); // BOM/lixo antes do %PDF-
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  assert.equal(sniffDocument(zip, 'planilha.xlsx')?.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(sniffDocument(zip, 'minuta.DOCX')?.ext, 'docx');
  assert.deepEqual(sniffDocument(zip, 'anexos.zip'), { mime: 'application/zip', ext: 'zip', extractable: false });
  assert.equal(sniffDocument(zip, 'anexos')?.extractable, false);
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);
  assert.equal(sniffDocument(ole, 'x.xls')?.mime, 'application/vnd.ms-excel');
  assert.equal(sniffDocument(ole, 'x.doc')?.mime, 'application/msword');
  assert.equal(sniffDocument(new TextEncoder().encode('item 1; 10\n'), 'dados.csv')?.mime, 'text/plain');
  assert.equal(sniffDocument(new TextEncoder().encode('texto'), 'edital.pdf'), null); // extensão diz pdf, conteúdo não é
  assert.equal(sniffDocument(new TextEncoder().encode('<!DOCTYPE html><html>erro</html>'), 'edital.pdf'), null);
  assert.equal(sniffDocument(new TextEncoder().encode('<!DOCTYPE html>'), 'pagina.txt')?.ext, 'txt'); // .txt é aceito como texto puro, mas nunca interpretado como HTML
  assert.equal(sniffDocument(new Uint8Array([0x4d, 0x5a, 0x90, 0]), 'edital.pdf'), null); // executável PE
  assert.equal(sniffDocument(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), 'edital.pdf'), null); // ELF
  assert.equal(sniffDocument(new Uint8Array(), 'vazio.pdf'), null);
  assert.equal(sniffDocument(new Uint8Array([0x41, 0, 0x42]), 'bin.txt'), null); // texto com NUL
});
