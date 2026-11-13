/**
 * Verificação do pipeline completo e geração de artefatos de inspeção.
 *
 * Executa exatamente o mesmo caminho de código que as rotas do Next.js usam
 * (extração → análise → normalização → relatório), sem depender de subir o
 * servidor HTTP. Útil em ambientes onde não é possível iniciar processos filhos
 * (sandbox, CI restritivo) e para gerar artefatos de revisão visual.
 *
 *   node scripts/verify-pipeline.mjs
 *
 * Saídas em test-output/:
 *   · edital-demo.pdf        — edital fictício enviado ao pipeline
 *   · relatorio.html         — relatório completo (abra no navegador)
 *   · relatorio-demo.pdf     — PDF do relatório (quando há navegador headless)
 *   · analise.json           — análise estruturada validada pelo schema
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const OUT = join(ROOT, '.test-build');
const ARTIFACTS = join(ROOT, 'test-output');

/* ------------------------- Compilação em processo ------------------------- */

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
}

const load = (relativePath) => import(pathToFileURL(join(OUT, relativePath)).href);

buildTestBuild();

const { buildDemoEditalPdf } = await load('fixtures/demo-edital.js');
const { extractDocument, assertHasTextLayer } = await load('pdf/extract.js');
const { analyzeLocally } = await load('ai/local.js');
const { analiseSchema, evidenceText, isNotFound } = await load('schema.js');
const { renderReportHtml, reportFileName } = await load('report/document.js');
const { findBrowser, htmlToPdf } = await load('report/browser.js');
const { buildChunks, isDocumentLong, estimateTokens } = await load('chunking.js');

mkdirSync(ARTIFACTS, { recursive: true });

const line = (label) => console.log(`\n\u2500\u2500 ${label} ${'\u2500'.repeat(Math.max(2, 62 - label.length))}`);

console.log('Verificação do pipeline — Analisador Inteligente de Editais');

/* 1. Edital de demonstração */
line('1. Edital de demonstração');
const startedAt = Date.now();
const demoPdf = buildDemoEditalPdf();
writeFileSync(join(ARTIFACTS, 'edital-demo.pdf'), demoPdf);
console.log(`  · PDF gerado: ${(demoPdf.byteLength / 1024).toFixed(1)} KB em ${Date.now() - startedAt} ms`);

/* 2. Extração */
line('2. Extração de texto');
const extractStart = Date.now();
const document_ = await extractDocument(demoPdf);
assertHasTextLayer(document_);
console.log(`  · ${document_.totalPages} páginas, ${document_.totalChars} caracteres, ~${document_.words} palavras`);
console.log(`  · tempo de extração: ${Date.now() - extractStart} ms`);
console.log(`  · cabe em uma única chamada de modelo? ${isDocumentLong(document_) ? 'não (usa blocos)' : 'sim'}`);
const chunks = buildChunks(document_);
console.log(
  `  · blocos: ${chunks.length} · tokens estimados: ${estimateTokens(document_.fullText).toLocaleString('pt-BR')}`,
);

/* 3. Análise */
line('3. Análise (motor local de demonstração)');
const analysisStart = Date.now();
const analise = analyzeLocally(document_, {
  fileName: 'edital-demo.pdf',
  dataAnalise: new Date().toISOString(),
});
analiseSchema.parse(analise);
console.log(`  · tempo de análise: ${Date.now() - analysisStart} ms`);
console.log(`  · órgão: ${evidenceText(analise.informacoesGerais.orgao)}`);
console.log(`  · número: ${evidenceText(analise.informacoesGerais.numeroEdital)}`);
console.log(`  · modalidade: ${evidenceText(analise.informacoesGerais.modalidade)}`);
console.log(`  · valor estimado: ${evidenceText(analise.valores.valorEstimado)}`);
console.log(`  · cronograma: ${analise.cronograma.length} marcos`);
for (const entry of analise.cronograma) {
  console.log(`      - ${entry.data}${entry.hora ? ` ${entry.hora}` : ''} · ${entry.evento} (${entry.source ?? '—'})`);
}
console.log(`  · itens do objeto: ${analise.objeto.itens?.length ?? 0}`);
console.log(
  `  · pontos de atenção: ${analise.pontosDeAtencao.length} (${analise.pontosDeAtencao.filter((p) => p.nivel === 'alto').length} de prioridade alta)`,
);
console.log(`  · checklist: ${analise.checklist.length} itens`);
const camposAusentes = Object.entries(analise.informacoesGerais).filter(([, field]) => isNotFound(field));
console.log(`  · campos corretamente marcados como ausentes: ${camposAusentes.length}/10`);

writeFileSync(join(ARTIFACTS, 'analise.json'), JSON.stringify({ analise, meta: { engine: 'local-demo' } }, null, 2));
console.log('  · análise salva em test-output/analise.json');

/* 4. Relatório HTML */
line('4. Relatório (HTML de impressão)');
const meta = {
  engine: 'local-demo',
  chunks: chunks.length,
  llmCalls: 0,
  tokensEstimados: estimateTokens(document_.fullText),
  duracaoMs: Date.now() - startedAt,
  avisos: ['Verificação local: nenhuma chamada de IA foi realizada.'],
};

const html = renderReportHtml(analise, meta);
const htmlPath = join(ARTIFACTS, 'relatorio.html');
writeFileSync(htmlPath, html, 'utf8');
console.log(`  · HTML gerado: ${(html.length / 1024).toFixed(1)} KB → test-output/relatorio.html`);
console.log(`  · nome sugerido do PDF: ${reportFileName(analise)}`);

/* 5. PDF do relatório */
line('5. PDF do relatório (navegador headless)');
const browser = await findBrowser();
if (!browser) {
  console.log('  ! navegador headless não encontrado — pulando geração do PDF');
  console.log('    defina REPORT_BROWSER_PATH no .env para habilitar');
} else {
  console.log(`  · navegador: ${browser}`);
  const pdfStart = Date.now();
  try {
    const reportPdf = await htmlToPdf(html);
    const pdfPath = join(ARTIFACTS, 'relatorio-demo.pdf');
    writeFileSync(pdfPath, reportPdf);
    const pageCount = (reportPdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    console.log(
      `  · PDF gerado: ${(reportPdf.byteLength / 1024).toFixed(1)} KB, ${pageCount} páginas em ${Date.now() - pdfStart} ms`,
    );
    console.log('  · arquivo: test-output/relatorio-demo.pdf');
  } catch (error) {
    console.log(`  ! falha ao gerar o PDF: ${error.message}`);
    if (error.details) console.log(`    detalhes: ${String(error.details).slice(0, 400)}`);
    console.log('    o relatório HTML continua disponível para impressão manual');
  }
}

line('Concluído');
console.log(`Artefatos em: ${ARTIFACTS}\n`);
