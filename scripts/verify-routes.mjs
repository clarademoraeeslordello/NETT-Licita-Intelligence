/**
 * Verificação das rotas de dados em processo.
 *
 * As rotas do Next.js são finas: apenas traduzem HTTP para as funções de
 * `src/lib`. Este script exercita exatamente essas funções (store → análise →
 * relatório) verificando os contratos que as rotas expõem, sem depender de
 * subir o servidor HTTP. Útil para validar o caminho de reaproveitamento de
 * cache, o estado do job e a renderização do relatório.
 *
 *   node scripts/verify-routes.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const OUT = join(ROOT, '.test-build');
const ARTIFACTS = join(ROOT, 'test-output');

// A verificação de rotas não deve tocar a rede: força o motor local mesmo que
// DEEPSEEK_API_KEY esteja exportada no shell de quem roda os testes.
delete process.env.DEEPSEEK_API_KEY;

/* --------------------------- Compilação --------------------------- */

function buildTestBuild() {
  const ts = require('typescript');
  const { readdirSync, statSync } = require('node:fs');
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
  const fix = (fromFile, specifier) => {
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
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(
      outFile,
      output.outputText.replace(importPattern, (match, prefix, quote, specifier) => {
        if (/\.(js|json|mjs|cjs|css)$/.test(specifier)) return match;
        return `${prefix}${quote}${fix(outFile, specifier)}${quote}`;
      }),
      'utf8',
    );
  }
}

buildTestBuild();
const load = (p) => import(pathToFileURL(join(OUT, p)).href);

const { createJob, updateJob, getJob, toPublicJob, getAnalysis, refreshJobPresentation } = await load('store.js');
const { startAnalysis, hashBuffer } = await load('service.js');
const { getDemoPdf } = await load('demo.js');
const { renderReportHtml, reportFileName } = await load('report/document.js');
const { extractDocument, assertHasTextLayer } = await load('pdf/extract.js');
const { analyzeLocally } = await load('ai/local.js');
const { analiseSchema } = await load('schema.js');
const { buildChunks, buildPageIndex } = await load('chunking.js');

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

console.log('\n\u2500\u2500 Verifica\u00e7\u00e3o das rotas de dados \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

/* ------------------------- Fluxo do job ------------------------- */
console.log('\n[1] Ciclo de vida do job (store + service)');

let job;
await check('cria job e publica o estado inicial esperado pela interface', () => {
  job = createJob({ fileName: 'edital-teste.pdf', fileSize: 50_000, isDemo: true });
  const publicJob = toPublicJob(job);
  assert.ok(publicJob.id, 'job sem id');
  assert.equal(publicJob.stage, 'received');
  assert.equal(publicJob.steps.length, 5);
  assert.equal(publicJob.steps[0].status, 'active');
  assert.equal(publicJob.hasResult, false);
  assert.match(publicJob.fileSizeLabel, /KB/);
});

await check('progresso \u00e9 monot\u00f4nico e limitado a 100', () => {
  updateJob(job.id, { stage: 'extracting', progress: 40, message: 'Extraindo' });
  updateJob(job.id, { stage: 'analyzing', progress: 20, message: 'Analisando' });
  const current = getJob(job.id);
  assert.equal(current.progress, 40, 'progresso n\u00e3o deveria regredir');
  updateJob(job.id, { stage: 'done', progress: 180, message: 'Pronto' });
  assert.equal(getJob(job.id).progress, 100, 'progresso deveria ser limitado a 100');
});

await check('todas as etapas ficam conclu\u00eddas no fim do fluxo', () => {
  const current = getJob(job.id);
  assert.equal(current.stage, 'done');
  assert.ok(current.steps.every((step) => step.status === 'done'));
  assert.ok(current.events.length >= 3, 'trilha de eventos incompleta');
});

await check('job inexistente n\u00e3o quebra updateJob nem getAnalysis', () => {
  assert.equal(updateJob('id-inexistente', { stage: 'done' }), undefined);
  assert.equal(getAnalysis('id-inexistente'), undefined);
});

/* --------------------- Pipeline + an\u00e1lise real --------------------- */
console.log('\n[2] Pipeline completo at\u00e9 o relat\u00f3rio');

const { buffer: demoPdf, fileName } = getDemoPdf();
const document_ = await extractDocument(demoPdf);
assertHasTextLayer(document_);
const analise = analyzeLocally(document_, { fileName, dataAnalise: new Date().toISOString() });

await check('an\u00e1lise do PDF de demonstra\u00e7\u00e3o passa no schema', () => {
  assert.doesNotThrow(() => analiseSchema.parse(analise));
});

await check('job com resultado \u00e9 servido por getAnalysis (rota /analysis)', () => {
  updateJob(job.id, { stage: 'done', progress: 100, result: { analise, meta: { engine: 'local-demo', avisos: [] } } });
  const found = getAnalysis(job.id);
  assert.ok(found, 'getAnalysis n\u00e3o encontrou o job');
  assert.equal(found.analise.informacoesGerais.numeroEdital.value, '042/2025');
  assert.equal(found.job.result.meta.engine, 'local-demo');
});

await check('relat\u00f3rio HTML \u00e9 gerado a partir do job (rota /report.html)', () => {
  const found = getAnalysis(job.id);
  const html = renderReportHtml(found.analise, found.job.result.meta);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('Checklist de Participa\u00e7\u00e3o'));
  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(join(ARTIFACTS, 'relatorio-verificado.html'), html, 'utf8');
});

await check('nome do PDF de download \u00e9 seguro', () => {
  assert.match(reportFileName(analise), /^analise-edital-[a-z0-9-]+\.pdf$/);
});

/* -------------------------- Cache por hash -------------------------- */
console.log('\n[3] Reaproveitamento de resultado (cache)');

await check('mesmo arquivo + mesmo motor reaproveita o job', async () => {
  const primeiro = await startAnalysis({ buffer: demoPdf, fileName, fileSize: demoPdf.byteLength, isDemo: true });
  assert.equal(primeiro.reused, false, 'primeira an\u00e1lise n\u00e3o deveria reaproveitar');
  // A an\u00e1lise roda em background; injetamos um resultado para simular a conclus\u00e3o.
  updateJob(primeiro.job.id, {
    stage: 'done',
    progress: 100,
    result: { analise, meta: { engine: 'local-demo', avisos: [] } },
  });

  const segundo = await startAnalysis({ buffer: demoPdf, fileName, fileSize: demoPdf.byteLength, isDemo: true });
  assert.equal(segundo.reused, true, 'segunda an\u00e1lise deveria reaproveitar o cache');
  assert.equal(segundo.job.id, primeiro.job.id);
});

await check('reaproveitamento atualiza o selo de origem e o nome do arquivo', async () => {
  const upload = await startAnalysis({
    buffer: demoPdf,
    fileName: 'meu-edital.pdf',
    fileSize: demoPdf.byteLength,
    isDemo: false,
  });
  assert.equal(upload.reused, true);
  assert.equal(upload.job.fileName, 'meu-edital.pdf');
  assert.equal(upload.job.isDemo, false);
});

await check('hash do arquivo \u00e9 est\u00e1vel e distingue conte\u00fados', () => {
  const a = hashBuffer(demoPdf);
  const b = hashBuffer(demoPdf);
  const c = hashBuffer(Buffer.from('%PDF-1.4\ndiferente\n%%EOF', 'latin1'));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

await check('payload do job n\u00e3o carrega a an\u00e1lise inteira (resposta leve do SSE)', () => {
  const publicJob = toPublicJob(getJob(job.id));
  assert.equal('result' in publicJob, false, 'toPublicJob n\u00e3o deve expor o resultado completo');
  assert.equal(publicJob.hasResult, true);
});

/* --------------------------- Or\u00e7amento --------------------------- */
console.log('\n[4] Contratos auxiliares usados pelas rotas');

await check('\u00edndice de p\u00e1ginas e blocos s\u00e3o consistentes', () => {
  const index = buildPageIndex(document_);
  const chunks = buildChunks(document_);
  assert.equal(index.length, document_.totalPages);
  assert.ok(chunks.every((chunk) => chunk.pages.length > 0));
  assert.equal(chunks[0].pages[0], 1);
});

/* ----------- Conclusão real do pipeline (sem injeção de resultado) ----------- */
console.log('\n[5] Conclus\u00e3o real do pipeline (motor local)');

const { runAnalysis } = await load('analysis.js');

const freshJob = createJob({ fileName: 'conclusao-real.pdf', fileSize: demoPdf.byteLength, isDemo: true });
const produced = await runAnalysis(demoPdf, freshJob.id, {
  fileName: 'conclusao-real.pdf',
  fileSize: demoPdf.byteLength,
});
const finished = getJob(freshJob.id);

await check('o pipeline grava o resultado no job ao concluir', () => {
  // Regress\u00e3o: sem essa grava\u00e7\u00e3o o stream SSE nunca emite `done` e a
  // interface fica esperando at\u00e9 o watchdog \u2014 uma an\u00e1lise bem-sucedida
  // aparecia como "tempo m\u00e1ximo excedido".
  assert.ok(finished.result, 'o resultado n\u00e3o foi gravado no job');
  assert.equal(finished.stage, 'done');
  assert.equal(finished.progress, 100);
  assert.equal(finished.result.meta.engine, 'local-demo');
  assert.deepEqual(finished.result, produced);
});

await check('getAnalysis serve o resultado do pipeline real (rota /analysis)', () => {
  const found = getAnalysis(freshJob.id);
  assert.ok(found, 'getAnalysis n\u00e3o encontrou o resultado rec\u00e9m-produzido');
  assert.equal(found.job.id, freshJob.id);
  assert.ok(found.analise.cronograma.length > 0);
});

await check('toPublicJob anuncia hasResult para a interface', () => {
  const publicJob = toPublicJob(finished);
  assert.equal(publicJob.hasResult, true);
  assert.equal(publicJob.engine, 'local-demo');
});

console.log(
  `\n\u2500\u2500 Resultado: ${passed} verifica\u00e7\u00e3o(\u00f5es) aprovada(s), ${failures.length} falha(s) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n`,
);

if (failures.length) {
  for (const failure of failures) console.error(`\u2717 ${failure.name}\n${failure.error.stack}\n`);
  process.exit(1);
}
