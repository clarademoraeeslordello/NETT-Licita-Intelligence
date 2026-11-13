/**
 * Verificação manual da análise com IA REAL (consome tokens).
 *
 * Roda exatamente o mesmo pipeline das rotas do Next.js — extração → análise
 * (LLM) → normalização → schema — contra o provedor configurado, usando o
 * edital de demonstração. Serve para diagnosticar incidentes como resposta
 * truncada (`finish_reason=length`) e para conferir um novo modelo/limite.
 *
 *   node scripts/verify-ai-analysis.mjs --run
 *
 * Sem `--run` o script apenas descreve o que faria (nenhuma chamada é feita).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = join(ROOT, '.test-build');
const ARTIFACTS = join(ROOT, 'test-output');
const RUN = process.argv.includes('--run');

if (!RUN) {
  console.log('Verificação com IA real desativada.');
  console.log('Execute com --run para gastar tokens de verdade:');
  console.log('  node scripts/verify-ai-analysis.mjs --run\n');
  process.exit(0);
}

/* ------------------------------- .env.local ------------------------------- */
if (existsSync(join(ROOT, '.env.local'))) {
  for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

/* ------------------------- Compilação em processo ------------------------- */
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { readdirSync, statSync, rmSync } = require('node:fs');
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
  mkdirSync(dirname(outFile), { recursive: true });
  const code = output.outputText.replace(importPattern, (match, prefix, quote, specifier) => {
    if (/\.(js|json|mjs|cjs|css)$/.test(specifier)) return match;
    return `${prefix}${quote}${fixSpecifier(outFile, specifier)}${quote}`;
  });
  writeFileSync(outFile, code, 'utf8');
}

const load = (relativePath) => import(pathToFileURL(join(OUT, relativePath)).href);

const { buildDemoEditalPdf } = await load('fixtures/demo-edital.js');
const { startAnalysis } = await load('service.js');
const { getJob } = await load('store.js');
const { config } = await load('config.js');
const { analiseSchema } = await load('schema.js');

const pdfPath = join(ARTIFACTS, 'edital-demo.pdf');
const buffer = existsSync(pdfPath) ? readFileSync(pdfPath) : buildDemoEditalPdf();

console.log(`Modelo: ${config.ai.model}`);
console.log(
  `Orçamento de saída: ${config.ai.maxOutputTokens} tokens (teto ${config.ai.maxOutputTokensCeiling}, ${config.ai.maxOutputTokenEscalations} escalonamento(s))`,
);
console.log(`Documento: ${(buffer.byteLength / 1024).toFixed(1)} KB\n`);

const startedAt = Date.now();
const { job } = await startAnalysis({ buffer, fileName: 'edital-demo.pdf', fileSize: buffer.byteLength, isDemo: true });

let lastMessage = '';
while (Date.now() - startedAt < 10 * 60 * 1000) {
  const current = getJob(job.id);
  if (!current) break;

  const message = `${current.stage} ${Math.round(current.progress)}% — ${current.events.at(-1)?.message ?? ''}`;
  if (message !== lastMessage) {
    lastMessage = message;
    console.log(`  ${message}`);
  }

  if (current.stage === 'done' || current.stage === 'error') {
    console.log('');
    if (current.error) {
      console.error(`FALHOU [${current.error.code}]: ${current.error.message}`);
      if (current.error.hint) console.error(`  dica: ${current.error.hint}`);
      if (current.error.details) console.error(`  detalhe: ${current.error.details}`);
      process.exit(1);
    }

    const result = current.result;
    if (!result) {
      console.error('Job concluído sem resultado.');
      process.exit(1);
    }

    analiseSchema.parse(result.analise);
    mkdirSync(ARTIFACTS, { recursive: true });
    writeFileSync(join(ARTIFACTS, 'analise-ia.json'), JSON.stringify(result, null, 2), 'utf8');

    console.log('Análise concluída e validada pelo schema.');
    console.log(`  motor:     ${result.meta.engine} · ${result.meta.model}`);
    console.log(`  blocos:    ${result.meta.chunks} · chamadas: ${result.meta.llmCalls}`);
    console.log(`  tokens:    ${result.meta.tokensEstimados?.toLocaleString('pt-BR')}`);
    console.log(`  duração:   ${((result.meta.duracaoMs ?? 0) / 1000).toFixed(1)} s`);
    console.log(`  custo:     US$ ${(result.meta.custoEstimadoUSD ?? 0).toFixed(4)}`);
    console.log(`  cronograma: ${result.analise.cronograma.length} marco(s) · checklist: ${result.analise.checklist.length} item(ns) · atenção: ${result.analise.pontosDeAtencao.length}`);
    console.log('\nAvisos:');
    for (const aviso of result.meta.avisos) console.log(`  · ${aviso}`);
    console.log(`\nArtefato: test-output/analise-ia.json`);
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

console.error('Tempo esgotado aguardando a análise.');
process.exit(1);
