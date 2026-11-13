/**
 * Auditoria estática do CSS.
 *
 * Compila o design system (Tailwind v4 + globals.css) e verifica se TODAS as
 * classes utilitárias usadas nos componentes geram CSS real. Uma classe que não
 * resolve é um bug visual silencioso: o JSX compila, o type-check passa e a tela
 * aparece sem estilo.
 *
 *   node scripts/audit-css.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const ROOT = process.cwd();
const globalsPath = join(ROOT, 'src', 'app', 'globals.css');

/** Lista os arquivos de UI (JSX/TSX) do projeto. */
function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (['.tsx', '.ts'].includes(extname(full)) && !full.endsWith('.d.ts')) files.push(full);
  }
  return files;
}

const files = walk(join(ROOT, 'src'));
const sources = files.map((file) => ({ file, code: readFileSync(file, 'utf8') }));

/**
 * Extrai candidatos a classe utilitária de className="...", cn('...') e
 * template literals simples. Heurística suficiente porque o código não monta
 * nomes de classe dinamicamente a partir de variáveis.
 */
function extractClasses(code) {
  const found = new Set();
  const patterns = [/className=(?:"([^"]*)"|'([^']*)')/g, /className=\{`([^`]*)`\}/g, /cn\(([^)]*)\)/g];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const chunk = match[1] ?? match[2] ?? '';
      for (const token of chunk.split(/\s+/)) {
        const clean = token.replace(/[`'"{}()]/g, '').trim();
        if (!clean || clean.includes('$') || clean.includes('=>')) continue;
        // Só interessam classes (com letras) e variantes utilitárias.
        if (!/^[a-z@[]/i.test(clean)) continue;
        if (/[<>=?,;]/.test(clean)) continue;
        found.add(clean);
      }
    }
  }
  return found;
}

const classes = new Set();
for (const { code, file } of sources) {
  const fileClasses = extractClasses(code);
  for (const item of fileClasses) classes.add(item);
  if (/\.tsx$/.test(file) && fileClasses.size === 0 && !/icons/.test(file)) {
    // Aviso apenas informativo: alguns arquivos são só tipos ou helpers.
  }
}

/** Classes que são CSS próprio (definidas em globals.css) ou não-utilitárias. */
const cssOwned = new Set(['glass', 'grid-bg', 'scrollbar-slim', 'text-balance', 'text-pretty', 'print-block', 'no-print']);

/** Utilitários legítimos de uma só palavra (sem hífen) do Tailwind. */
const SINGLE_WORD = new Set([
  'flex', 'grid', 'block', 'hidden', 'inline', 'table', 'contents', 'italic', 'truncate',
  'underline', 'uppercase', 'lowercase', 'capitalize', 'antialiased', 'container', 'transform',
  'transition', 'border', 'outline', 'ring', 'shadow', 'relative', 'absolute', 'fixed', 'sticky',
  'static', 'isolate', 'collapse', 'invisible', 'visible', 'sr-only',
]);

/** Expressões dinâmicas (variáveis, ternários, condicionais) não são classes. */
const isDynamic = (name) =>
  /[.$?=<>]/.test(name) ||
  /^(true|false|null|undefined|nivel|pending|active|done|error|found|inferred|not_found)$/.test(name);

const candidates = [...classes].filter((name) => {
  const base = name.split(':').pop();
  if (cssOwned.has(base)) return false;
  if (isDynamic(name) || isDynamic(base)) return false;
  // Um utilitário do Tailwind tem hífen (bg-ink-50), variante (sm:) ou é de uma
  // palavra conhecida (flex, grid...). O resto é fragmento de template.
  if (!base.includes('-') && !name.includes(':') && !SINGLE_WORD.has(base)) return false;
  return true;
});

mkdirSync(join(ROOT, 'test-output'), { recursive: true });

const inline = candidates.map((name) => `@source inline("${name}");`).join('\n');
const css = readFileSync(globalsPath, 'utf8');
const result = await postcss([tailwind()]).process(`${inline}\n${css}`, { from: globalsPath });
const output = result.css;
writeFileSync(join(ROOT, 'test-output', 'tailwind.css'), output, 'utf8');

/** Uma classe resolve quando o CSS contém o seletor escapado correspondente. */
function escapeClass(name) {
  return name.replace(/[.:/[\]()%,#!]/g, (char) => `\\${char}`).replace(/\s+/g, '_');
}

const missing = [];
for (const name of candidates) {
  const selector = `.${escapeClass(name)}`;
  const variantes = [selector, `.${escapeClass(name.split(':').pop())}`];
  if (!variantes.some((variant) => output.includes(variant))) missing.push(name);
}

console.log('Auditoria de CSS — Analisador Inteligente de Editais\n');
console.log(`  · arquivos analisados: ${sources.length}`);
console.log(`  · classes candidatas:  ${candidates.length}`);
console.log(`  · CSS gerado:          ${(output.length / 1024).toFixed(1)} KB → test-output/tailwind.css\n`);

if (missing.length === 0) {
  console.log('  ✓ todas as classes utilitárias usadas nos componentes geram CSS');
} else {
  console.log(`  ✗ ${missing.length} classe(s) sem CSS correspondente:`);
  for (const name of missing.sort()) console.log(`      - ${name}`);
  console.log('\n  Verifique se o token existe no bloco @theme de src/app/globals.css.');
  process.exitCode = 1;
}
