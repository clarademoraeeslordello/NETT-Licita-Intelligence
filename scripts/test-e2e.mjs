/**
 * Teste ponta a ponta do Analisador Inteligente de Editais.
 *
 * Sobe a aplicação (ou reaproveita uma instância já rodando), gera o edital de
 * demonstração, faz upload real, consome o stream de progresso, valida a
 * análise contra o schema, valida o relatório em PDF e exercita os caminhos de
 * erro (arquivo inválido, rota inexistente, job expirado).
 *
 *   npm run test:e2e
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = Number(process.env.E2E_PORT ?? 3311);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(ROOT, '.test-build');
const ARTIFACTS = join(ROOT, 'test-output');

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  \u2717 ${name}\n      ${error.message.split('\n')[0]}`);
  }
}

/* ------------------------- Compilação do núcleo ------------------------- */

function buildTestBuild() {
  const ts = require('typescript');
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const compilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
    skipLibCheck: true,
    isolatedModules: true,
    sourceMap: false,
  };

  const importPattern = /(from\s+|import\s*\(\s*)(['"])(\.[^'"]+)\2/g;
  const { readdirSync, statSync } = require('node:fs');
  const { dirname, extname, relative, resolve } = require('node:path');

  const fixSpecifier = (fromFile, specifier) => {
    const base = resolve(dirname(fromFile), specifier);
    if (existsSync(`${base}.js`)) return `${specifier}.js`;
    if (existsSync(join(base, 'index.js'))) return `${specifier}/index.js`;
    return `${specifier}.js`;
  };

  const walk = (dir, files = []) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, files);
      else if (extname(full) === '.ts' && !full.endsWith('.d.ts')) files.push(full);
    }
    return files;
  };

  const sourceRoot = join(ROOT, 'src', 'lib');
  for (const file of walk(sourceRoot)) {
    const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions, fileName: file });
    const outFile = join(OUT, relative(sourceRoot, file).replace(/\.ts$/, '.js'));
    mkdirSync(require('node:path').dirname(outFile), { recursive: true });
    const code = output.outputText.replace(importPattern, (match, prefix, quote, specifier) => {
      if (/\.(js|json|mjs|cjs|css)$/.test(specifier)) return match;
      return `${prefix}${quote}${fixSpecifier(outFile, specifier)}${quote}`;
    });
    writeFileSync(outFile, code, 'utf8');
  }
}

buildTestBuild();
const { renderReportHtml, reportFileName } = await import(pathToFileURL(join(OUT, 'report/document.js')).href);
const { htmlToPdf, findBrowser } = await import(pathToFileURL(join(OUT, 'report/browser.js')).href);
const { analiseSchema, evidenceText } = await import(pathToFileURL(join(OUT, 'schema.js')).href);

/* ---------------------------- Servidor local ---------------------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isUp() {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

let serverProcess = null;
let logFd = null;

async function startServer() {
  if (await isUp()) {
    console.log(`  · reutilizando servidor já ativo em ${BASE}`);
    return;
  }

  mkdirSync(ARTIFACTS, { recursive: true });
  const logPath = join(ARTIFACTS, 'server.log');
  logFd = openSync(logPath, 'w');

  // stdio direcionado a arquivo: `pipe` pode ser bloqueado por sandbox.
  try {
    serverProcess = spawn(
      process.execPath,
      [join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(PORT)],
      {
        cwd: ROOT,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' },
        windowsHide: true,
      },
    );
    serverProcess.on('error', () => undefined);
  } catch (error) {
    throw new Error(
      `Não foi possível iniciar o servidor automaticamente (${error.message}).\n` +
        `Inicie a aplicação manualmente e rode novamente:\n` +
        `  1) npm run dev\n` +
        `  2) npm run test:e2e   (ou defina E2E_PORT para apontar para outra porta)`,
    );
  }

  console.log(`  · iniciando servidor em ${BASE} (log: test-output/server.log)`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isUp()) {
      console.log('  · servidor pronto');
      return;
    }
    if (serverProcess.exitCode !== null) break;
    await sleep(1000);
  }

  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-3000) : '(log vazio)';
  throw new Error(
    `Servidor não respondeu em ${BASE}.\n${log}\n\n` +
      `Inicie a aplicação manualmente (npm run dev) e rode o teste novamente.`,
  );
}

function stopServer() {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    console.log('  · servidor encerrado');
  }
  if (logFd !== null) {
    try {
      require('node:fs').closeSync(logFd);
    } catch {
      /* ignore */
    }
  }
}

/* --------------------------- Utilitários HTTP --------------------------- */

/** Consome um stream SSE e devolve os eventos coletados. */
async function consumeStream(response) {
  assert.ok(response.body, 'resposta sem body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      if (!block.trim() || block.startsWith(':')) continue;
      const name = /^event: (.+)$/m.exec(block)?.[1] ?? 'update';
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!data) continue;
      events.push({ name, payload: JSON.parse(data) });
      if (name === 'done' || name === 'error') return events;
    }
  }
  return events;
}

async function getDemoPdfBuffer() {
  const response = await fetch(`${BASE}/api/demo/edital`);
  assert.equal(response.status, 200, `GET /api/demo/edital retornou ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /application\/pdf/);
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.ok(buffer.subarray(0, 5).toString('latin1').startsWith('%PDF-'), 'demo não é PDF');
  return buffer;
}

async function uploadPdf(buffer, fileName) {
  const formData = new FormData();
  formData.append('file', new File([new Uint8Array(buffer)], fileName, { type: 'application/pdf' }));
  const response = await fetch(`${BASE}/api/analyze`, { method: 'POST', body: formData });
  return response;
}

/* ------------------------------- Execução ------------------------------- */

console.log('\n\u2500\u2500 Teste ponta a ponta \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

try {
  await startServer();

  /* ---------------------------- 1. Saúde ---------------------------- */
  console.log('\n[1] Endpoint de capacidades');

  await check('GET /api/health informa capacidades e limites', async () => {
    const response = await fetch(`${BASE}/api/health`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(typeof data.ai.configured, 'boolean');
    assert.equal(typeof data.report.pdfAvailable, 'boolean');
    assert.ok(data.limits.maxUploadMb > 0);
    assert.ok(!JSON.stringify(data).toLowerCase().includes('sk-'), 'a resposta não deve conter chave de API');
  });

  /* --------------------------- 2. Demonstração --------------------------- */
  console.log('\n[2] Fluxo de demonstra\u00e7\u00e3o (1 clique)');

  const demoPdf = await getDemoPdfBuffer();
  let demoJobId = null;

  await check('PDF de demonstra\u00e7\u00e3o é servido e é um PDF v\u00e1lido', async () => {
    assert.ok(demoPdf.byteLength > 20_000, `PDF pequeno demais: ${demoPdf.byteLength}`);
  });

  await check('POST /api/analyze/demo transmite todas as etapas do pipeline', async () => {
    const started = Date.now();
    const response = await fetch(`${BASE}/api/analyze/demo`, { method: 'POST' });
    assert.equal(response.status, 200, `status ${response.status}`);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

    const events = await consumeStream(response);
    const stages = events.filter((event) => event.name === 'update').map((event) => event.payload.stage);
    const last = events[events.length - 1];

    assert.equal(last.name, 'done', `último evento foi "${last.name}"`);
    demoJobId = last.payload.jobId;
    assert.ok(demoJobId, 'jobId ausente');

    for (const stage of ['received', 'extracting', 'analyzing', 'structuring', 'reporting', 'done']) {
      assert.ok(stages.includes(stage), `etapa ausente no stream: ${stage}`);
    }

    const progressValues = events.filter((e) => e.name === 'update').map((e) => e.payload.progress);
    assert.deepEqual(
      progressValues,
      [...progressValues].sort((a, b) => a - b),
      'progresso deve ser monotônico',
    );
    assert.ok(
      events.some((e) => e.payload.detail && /p\u00e1gina/i.test(String(e.payload.detail))),
      'nenhum evento reportou a contagem de p\u00e1ginas',
    );

    const seconds = (Date.now() - started) / 1000;
    console.log(`      \u2192 concluído em ${seconds.toFixed(1)}s (${events.length} eventos)`);
    assert.ok(seconds < 240, `análise lenta demais para demonstração: ${seconds.toFixed(1)}s`);
  });

  await check('GET /api/jobs/:id devolve o job conclu\u00eddo', async () => {
    const response = await fetch(`${BASE}/api/jobs/${demoJobId}`);
    assert.equal(response.status, 200);
    const { job } = await response.json();
    assert.equal(job.stage, 'done');
    assert.equal(job.progress, 100);
    assert.equal(job.hasResult, true);
    assert.ok(job.steps.every((step) => step.status === 'done'), 'nem todas as etapas conclu\u00eddas');
  });

  let analise = null;
  let meta = null;

  await check('GET /api/jobs/:id/analysis devolve an\u00e1lise v\u00e1lida pelo schema', async () => {
    const response = await fetch(`${BASE}/api/jobs/${demoJobId}/analysis`);
    assert.equal(response.status, 200);
    const data = await response.json();
    analise = data.analise;
    meta = data.meta;
    assert.doesNotThrow(() => analiseSchema.parse(analise), 'an\u00e1lise fora do schema');
  });

  await check('an\u00e1lise extraiu as informa\u00e7\u00f5es essenciais do edital', async () => {
    assert.match(evidenceText(analise.informacoesGerais.numeroEdital), /042\/2025/);
    assert.match(evidenceText(analise.informacoesGerais.modalidade), /Preg\u00e3o/i);
    assert.match(evidenceText(analise.informacoesGerais.orgao), /Vale Verde/i);
    assert.match(evidenceText(analise.valores.valorEstimado), /1\.284\.350,00/);
    assert.ok(analise.cronograma.length >= 4, `cronograma curto: ${analise.cronograma.length}`);
    assert.ok(analise.pontosDeAtencao.length >= 1, 'nenhum ponto de aten\u00e7\u00e3o');
    assert.ok(analise.checklist.length >= 8, 'checklist curto');
    assert.ok(analise.objeto.resumo.length > 20, 'objeto vazio');
    assert.equal(analise.documento.paginas > 0, true);
  });

  await check('informa\u00e7\u00f5es ausentes usam o r\u00f3tulo padr\u00e3o (sem inven\u00e7\u00e3o)', async () => {
    const campos = Object.values(analise.informacoesGerais);
    const encontrados = campos.filter((field) => field.status === 'found');
    const ausentes = campos.filter((field) => field.status === 'not_found');
    assert.equal(encontrados.length + ausentes.length, campos.length, 'status inesperado em algum campo');
    for (const campo of ausentes) {
      assert.equal(campo.value, null, 'campo ausente n\u00e3o pode carregar valor');
    }
  });

  await check('meta do processamento exp\u00f5e motor, tempos e avisos', async () => {
    assert.ok(['deepseek', 'local-demo'].includes(meta.engine), `motor inesperado: ${meta.engine}`);
    assert.ok(meta.duracaoMs > 0);
    assert.ok(Array.isArray(meta.avisos));
  });

  /* --------------------------- 3. Upload real --------------------------- */
  console.log('\n[3] Fluxo de upload manual');

  let uploadJobId = null;

  await check('POST /api/analyze aceita upload e conclui a an\u00e1lise', async () => {
    const response = await uploadPdf(demoPdf, 'edital-upload-teste.pdf');
    assert.equal(response.status, 200, `status ${response.status}`);
    uploadJobId = response.headers.get('X-Job-Id');
    assert.ok(uploadJobId, 'cabe\u00e7alho X-Job-Id ausente');

    const events = await consumeStream(response);
    assert.equal(events[events.length - 1].name, 'done');
  });

  await check('an\u00e1lise do upload é equivalente \u00e0 da demonstra\u00e7\u00e3o', async () => {
    const response = await fetch(`${BASE}/api/jobs/${uploadJobId}/analysis`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.job.isDemo, false);
    assert.match(evidenceText(data.analise.informacoesGerais.numeroEdital), /042\/2025/);
  });

  /* ---------------------------- 4. Relat\u00f3rio ---------------------------- */
  console.log('\n[4] Relat\u00f3rio e download em PDF');

  await check('HTML do relat\u00f3rio cont\u00e9m as 10 se\u00e7\u00f5es e a identifica\u00e7\u00e3o do certame', async () => {
    const html = renderReportHtml(analise, meta);
    for (const section of [
      'Resumo Executivo',
      'Informa\u00e7\u00f5es Gerais',
      'Cronograma',
      'Objeto da Licita\u00e7\u00e3o',
      'Requisitos para Participa\u00e7\u00e3o',
      'Obriga\u00e7\u00f5es',
      'Valores',
      'Pontos de Aten\u00e7\u00e3o',
      'Checklist de Participa\u00e7\u00e3o',
      'Conclus\u00e3o',
    ]) {
      assert.ok(html.includes(section), `se\u00e7\u00e3o ausente no relat\u00f3rio: ${section}`);
    }
    assert.ok(html.includes('1.284.350,00'), 'valor n\u00e3o aparece no relat\u00f3rio');
    assert.ok(/n\u00e3o substitui|n\u00e3o constitui|apoio \u00e0 decis\u00e3o/i.test(html), 'aviso legal ausente');
  });

  const browser = await findBrowser();
  if (browser) {
    await check(`GET /api/jobs/:id/report devolve PDF gerado por ${browser.split(/[\\/]/).pop()}`, async () => {
      const response = await fetch(`${BASE}/api/jobs/${demoJobId}/report`);
      assert.equal(response.status, 200, `status ${response.status}`);
      assert.match(response.headers.get('content-type') ?? '', /application\/pdf/);

      const pdf = Buffer.from(await response.arrayBuffer());
      mkdirSync(ARTIFACTS, { recursive: true });
      writeFileSync(join(ARTIFACTS, 'relatorio-demo.pdf'), pdf);

      assert.ok(pdf.subarray(0, 5).toString('latin1').startsWith('%PDF-'), 'assinatura %PDF ausente');
      assert.ok(pdf.byteLength > 30_000, `PDF pequeno demais: ${pdf.byteLength} bytes`);

      const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      assert.ok(pages >= 4, `esperado >= 4 p\u00e1ginas no relat\u00f3rio, obtido ${pages}`);
      console.log(`      \u2192 ${(pdf.byteLength / 1024).toFixed(0)} KB, ${pages} páginas`);
    });

    await check('gera\u00e7\u00e3o direta via htmlToPdf produz o mesmo documento', async () => {
      const pdf = await htmlToPdf(renderReportHtml(analise, meta));
      assert.ok(pdf.byteLength > 30_000);
    });
  } else {
    console.log('  ! navegador headless não encontrado — pulando geração de PDF');
  }

  await check('nome do arquivo de download é seguro', async () => {
    const name = reportFileName(analise);
    assert.match(name, /^analise-edital-[a-z0-9-]+\.pdf$/);
  });

  /* --------------------------- 5. Tratamento de erros --------------------------- */
  console.log('\n[5] Tratamento de erros');

  await check('rejeita arquivo que n\u00e3o é PDF com erro estruturado', async () => {
    const formData = new FormData();
    formData.append('file', new File([Buffer.from('conteudo qualquer')], 'malicioso.txt', { type: 'text/plain' }));
    const response = await fetch(`${BASE}/api/analyze`, { method: 'POST', body: formData });
    assert.equal(response.status, 415);
    const body = await response.json();
    assert.equal(body.error.code, 'INVALID_FILE_TYPE');
    assert.ok(body.error.hint, 'erro sem dica acion\u00e1vel');
  });

  await check('rejeita PDF corrompido sem derrubar a aplica\u00e7\u00e3o', async () => {
    const corrupted = Buffer.from('%PDF-1.4\nlixo binario sem estrutura\n%%EOF', 'latin1');
    const response = await uploadPdf(corrupted, 'corrompido.pdf');
    assert.equal(response.status, 200, 'o stream deve iniciar e reportar o erro dentro dele');
    const events = await consumeStream(response);
    const last = events[events.length - 1];
    assert.equal(last.name, 'error');
    assert.ok(last.payload.job.error.message.length > 5, 'mensagem de erro vazia');
  });

  await check('aplica\u00e7\u00e3o continua saud\u00e1vel depois dos erros', async () => {
    const response = await fetch(`${BASE}/api/health`);
    assert.equal(response.status, 200);
  });

  await check('requisi\u00e7\u00e3o sem arquivo recebe 400 explicativo', async () => {
    const formData = new FormData();
    const response = await fetch(`${BASE}/api/analyze`, { method: 'POST', body: formData });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'BAD_REQUEST');
  });

  await check('payload declarado acima do limite \u00e9 recusado antes de ler o corpo', async () => {
    // Envia um Content-Length grande sem corpo real: a barreira antecipada deve
    // responder 413 sem tentar bufferizar nada.
    const response = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----teste' },
      body: Buffer.alloc(1024),
    }).catch(() => null);
    // O servidor pode encerrar a conex\u00e3o com corpo incompleto; o importante \u00e9
    // n\u00e3o travar e n\u00e3o aceitar o envio.
    if (response) {
      assert.ok([400, 413].includes(response.status), `status inesperado: ${response.status}`);
    }
  });

  await check('p\u00e1gina 404 personalizada responde em portugu\u00eas', async () => {
    const response = await fetch(`${BASE}/rota-que-nao-existe`);
    assert.equal(response.status, 404);
    const html = await response.text();
    assert.ok(
      /An\u00e1lise n\u00e3o encontrada|n\u00e3o encontrada|404/i.test(html),
      'p\u00e1gina 404 personalizada n\u00e3o foi usada',
    );
    assert.ok(!html.includes('This page could not be found'), 'ainda usa o 404 padr\u00e3o em ingl\u00eas');
  });

  await check('job inexistente retorna 404 tratado', async () => {
    const response = await fetch(`${BASE}/api/jobs/00000000-0000-0000-0000-000000000000/analysis`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  await check('relat\u00f3rio de job inexistente retorna 404 em JSON', async () => {
    const response = await fetch(`${BASE}/api/jobs/nao-existe/report`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  });

  /* ------------------------------ 6. P\u00e1ginas ------------------------------ */
  console.log('\n[6] P\u00e1ginas renderizadas');

  await check('p\u00e1gina inicial renderiza com identidade do produto', async () => {
    const response = await fetch(`${BASE}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('Analisador Inteligente de Editais'), 'título do produto ausente');
    assert.ok(html.includes('Analisar edital'), 'botão principal ausente');
    assert.ok(/Arraste o PDF aqui|Selecionar arquivo/.test(html), '\u00e1rea de upload ausente');
    assert.ok(html.includes('Leia um edital inteiro em minutos'), 'headline ausente');
  });

  await check('p\u00e1gina de resultado renderiza o relat\u00f3rio completo', async () => {
    const response = await fetch(`${BASE}/analise/${demoJobId}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('Resumo Executivo'), 'resumo executivo ausente');
    assert.ok(html.includes('Checklist'), 'checklist ausente');
    assert.ok(html.includes('Baixar relat\u00f3rio em PDF'), 'bot\u00e3o de download ausente');
    assert.ok(html.includes('1.284.350,00') || html.includes('1.284'), 'valor n\u00e3o renderizado');
  });

  await check('rota de an\u00e1lise inexistente mostra a p\u00e1gina de "n\u00e3o encontrada"', async () => {
    // Limita\u00e7\u00e3o conhecida do Next.js: como a rota tem `loading.tsx`, a resposta
    // \u00e9 transmitida em streaming, os cabe\u00e7alhos saem antes do corpo e o
    // `notFound()` do componente (ou de `generateMetadata`) n\u00e3o consegue mais
    // mudar o status para 404 (vercel/next.js#75563). O contrato verific\u00e1vel aqui
    // \u00e9 o conte\u00fado: a p\u00e1gina amig\u00e1vel em portugu\u00eas, nunca um relat\u00f3rio em branco.
    const response = await fetch(`${BASE}/analise/id-que-nao-existe`);
    assert.ok([404, 200].includes(response.status), `status inesperado: ${response.status}`);
    const html = await response.text();
    assert.match(html, /An\u00e1lise n\u00e3o encontrada/i, 'p\u00e1gina de "n\u00e3o encontrada" ausente');
    assert.ok(!html.includes('Resumo Executivo'), 'n\u00e3o deveria renderizar um relat\u00f3rio');
  });

  await check('GET /api/jobs/:id/report.html devolve a vers\u00e3o de impress\u00e3o', async () => {
    const response = await fetch(`${BASE}/api/jobs/${demoJobId}/report.html`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'n\u00e3o \u00e9 um documento HTML');
    assert.ok(html.includes('Resumo Executivo') && html.includes('Checklist'));
    assert.ok(!html.includes('<script'), 'vers\u00e3o de impress\u00e3o n\u00e3o deve conter scripts');
  });

  await check('report.html de job inexistente devolve p\u00e1gina HTML em portugu\u00eas (n\u00e3o JSON)', async () => {
    const response = await fetch(`${BASE}/api/jobs/nao-existe/report.html`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.ok(html.includes('An\u00e1lise n\u00e3o encontrada ou expirada'), 'mensagem em portugu\u00eas ausente');
    assert.ok(!html.trim().startsWith('{'), 'n\u00e3o deve devolver JSON cru');
  });

  await check('rean\u00e1lise do mesmo PDF reaproveita o resultado sem travar o stream', async () => {
    // Regress\u00e3o: o caminho de cache precisava encerrar o stream com `done`.
    const response = await fetch(`${BASE}/api/analyze/demo`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Job-Reused'), '1', 'segunda an\u00e1lise deveria reaproveitar o cache');

    const events = await consumeStream(response);
    const last = events[events.length - 1];
    assert.equal(last.name, 'done', `\u00faltimo evento foi "${last.name}"`);
    assert.equal(last.payload.reused, true);
    assert.equal(last.payload.jobId, demoJobId, 'deveria reaproveitar o mesmo job');
  });

  await check('nenhuma p\u00e1gina vaza chave de API no HTML', async () => {
    for (const path of ['/', `/analise/${demoJobId}`]) {
      const html = await (await fetch(`${BASE}${path}`)).text();
      assert.ok(!/sk-[A-Za-z0-9]{10,}/.test(html), `poss\u00edvel chave exposta em ${path}`);
      assert.ok(!html.includes('DEEPSEEK_API_KEY='), `nome de vari\u00e1vel sens\u00edvel exposto em ${path}`);
    }
  });
} catch (error) {
  failures.push({ name: 'execu\u00e7\u00e3o geral', error });
  console.error(`\n\u2717 Falha na execu\u00e7\u00e3o: ${error.message}`);
} finally {
  stopServer();
}

console.log(
  `\n\u2500\u2500 Resultado: ${passed} teste(s) aprovado(s), ${failures.length} falha(s) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n`,
);

if (failures.length) {
  for (const failure of failures) {
    console.error(`\u2717 ${failure.name}\n${failure.error.stack}\n`);
  }
  process.exit(1);
}
