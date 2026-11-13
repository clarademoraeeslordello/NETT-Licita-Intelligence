/**
 * Testes unitários do núcleo do Analisador Inteligente de Editais.
 *
 * Executa com Node puro (sem bundler) usando o type-stripping nativo do Node 22+,
 * o que permite testar o mesmo código TypeScript que roda em produção.
 *
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = process.cwd();
const OUT = join(ROOT, '.test-build');
const workDir = mkdtempSyncSafe();

function mkdtempSyncSafe() {
  const base = join(tmpdir(), `editais-unit-${Date.now()}`);
  mkdirSync(base, { recursive: true });
  return base;
}

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  \u2717 ${name}\n      ${error.message.split('\n')[0]}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  \u2717 ${name}\n      ${error.message.split('\n')[0]}`);
  }
}

/**
 * Compila `src/lib` em `.test-build/` usando a API do TypeScript em processo.
 * Evita `child_process` (bloqueado em alguns sandboxes) e mantém os testes
 * rodando exatamente o mesmo código que o Next.js usa no servidor.
 */
function buildTestBuild() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const compilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    skipLibCheck: true,
    isolatedModules: true,
    verbatimModuleSyntax: false,
    sourceMap: false,
    removeComments: false,
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
  let count = 0;

  for (const file of walk(sourceRoot)) {
    const output = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions,
      fileName: file,
      reportDiagnostics: true,
    });
    for (const diagnostic of output.diagnostics ?? []) {
      if (diagnostic.category === ts.DiagnosticCategory.Error) {
        throw new Error(
          `Erro de transpilação em ${relative(ROOT, file)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
        );
      }
    }

    const outFile = join(OUT, relative(sourceRoot, file).replace(/\.ts$/, '.js'));
    mkdirSync(dirname(outFile), { recursive: true });

    const code = output.outputText.replace(importPattern, (match, prefix, quote, specifier) => {
      if (/\.(js|json|mjs|cjs|css)$/.test(specifier)) return match;
      return `${prefix}${quote}${fixSpecifier(outFile, specifier)}${quote}`;
    });

    writeFileSync(outFile, code, 'utf8');
    count += 1;
  }

  console.log(`  · ${count} arquivo(s) de src/lib compilado(s) para .test-build/\n`);
  return OUT;
}

buildTestBuild();
const load = (relative) => import(pathToFileURL(join(OUT, relative)).href);

console.log('\n\u2500\u2500 N\u00facleo \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

const { buildDemoEditalPdf } = await load('fixtures/demo-edital.js');
const { extractDocument, assertHasTextLayer } = await load('pdf/extract.js');
const { buildChunks, isDocumentLong, estimateTokens, buildPageIndex } = await load('chunking.js');
const { normalizeAnalysis, normalizeEvidence, isBlank } = await load('ai/normalize.js');
const { analyzeLocally } = await load('ai/local.js');
const { buildReduceUserPrompt, computeReduceBudget, REDUCE_INSTRUCTIONS } = await load('ai/prompts.js');
const REDUCE_MARKER = REDUCE_INSTRUCTIONS.slice(0, 40);
const { analiseSchema, evidenceText, NOT_FOUND_LABEL } = await load('schema.js');
const { renderReportHtml, reportFileName } = await load('report/document.js');
const { validateUpload } = await load('service.js');
const { parseModelJson, salvageTruncatedJson } = await load('ai/json.js');
const { nextOutputBudget } = await load('ai/client.js');
const { config } = await load('config.js');

/* ----------------------------- PDF de teste ----------------------------- */
console.log('\n[1] Gera\u00e7\u00e3o do edital de demonstra\u00e7\u00e3o');

let pdfBuffer;
check('gera um PDF v\u00e1lido com assinatura %PDF', () => {
  pdfBuffer = buildDemoEditalPdf();
  assert.ok(Buffer.isBuffer(pdfBuffer), 'esperado Buffer');
  assert.ok(pdfBuffer.subarray(0, 5).toString('latin1').startsWith('%PDF-'), 'assinatura %PDF ausente');
  assert.ok(pdfBuffer.byteLength > 20_000, `PDF muito pequeno: ${pdfBuffer.byteLength} bytes`);
});

check('encerra com %%EOF e possui xref', () => {
  const text = pdfBuffer.toString('latin1');
  assert.ok(text.includes('startxref'), 'startxref ausente');
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'EOF ausente');
});

/* ------------------------------- Extra\u00e7\u00e3o ------------------------------- */
console.log('\n[2] Extra\u00e7\u00e3o de texto do PDF');

let document_;
await checkAsync('extrai texto p\u00e1gina a p\u00e1gina preservando a pagina\u00e7\u00e3o', async () => {
  document_ = await extractDocument(pdfBuffer);
  assert.ok(document_.totalPages >= 7, `esperado >= 7 p\u00e1ginas, obtido ${document_.totalPages}`);
  assert.ok(document_.totalChars > 8_000, `pouco texto extra\u00eddo: ${document_.totalChars} caracteres`);
  assert.ok(document_.pages.every((page) => page.page >= 1), 'pagina\u00e7\u00e3o inv\u00e1lida');
  assert.ok(document_.fullText.includes('[P\u00c1GINA 1]'), 'marcador de p\u00e1gina ausente no texto consolidado');
});

await checkAsync('mant\u00e9m acentua\u00e7\u00e3o do portugu\u00eas', async () => {
  const text = document_.fullText;
  for (const term of ['PREG\u00c3O', 'LICITA\u00c7\u00c3O', 'HABILITA\u00c7\u00c3O', 'MUNIC\u00cdPIO']) {
    assert.ok(text.toUpperCase().includes(term), `termo ausente ap\u00f3s extra\u00e7\u00e3o: ${term}`);
  }
});

await checkAsync('cont\u00e9m as informa\u00e7\u00f5es-chave do certame', async () => {
  const text = document_.fullText;
  for (const term of ['042/2025', '22/07/2025', '1.284.350,00', 'Vale Verde', 'Menor pre\u00e7o por lote']) {
    assert.ok(text.includes(term), `informa\u00e7\u00e3o ausente no texto extra\u00eddo: ${term}`);
  }
});

await checkAsync('detecta PDF sem camada de texto', async () => {
  const tiny = buildDemoEditalPdf();
  const fakeDoc = { pages: [{ page: 1, text: 'curto', chars: 5 }], fullText: 'curto', totalPages: 1, totalChars: 5, words: 1 };
  assert.throws(() => assertHasTextLayer(fakeDoc), /texto selecion/i);
  assert.ok(tiny.byteLength > 0);
});

/* -------------------------------- Chunking ------------------------------- */
console.log('\n[3] Estrat\u00e9gia de divis\u00e3o de documentos longos');

check('documento de teste cabe em uma \u00fanica chamada', () => {
  assert.equal(isDocumentLong(document_), false);
  const chunks = buildChunks(document_);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].pages.length, document_.totalPages);
});

check('documento longo \u00e9 dividido por p\u00e1ginas, sem perder conte\u00fado', () => {
  const longDocument = {
    ...document_,
    totalChars: 500_000, // acima do limite de chamada única (400 mil)
    fullText: document_.fullText,
  };
  assert.equal(isDocumentLong(longDocument), true);

  const chunks = buildChunks(longDocument);
  assert.ok(chunks.length > 1, 'esperado mais de um bloco');
  assert.ok(chunks.length <= 40, 'limite de blocos excedido');

  const covered = new Set(chunks.flatMap((chunk) => chunk.pages));
  for (let page = 1; page <= longDocument.totalPages; page += 1) {
    assert.ok(covered.has(page), `p\u00e1gina ${page} n\u00e3o coberta por nenhum bloco`);
  }
  assert.ok(
    chunks.every((chunk) => chunk.chars > 0 && chunk.text.length > 0),
    'bloco vazio gerado',
  );
});

check('\u00edndice de p\u00e1ginas e estimativa de tokens', () => {
  const index = buildPageIndex(document_);
  assert.equal(index.length, document_.totalPages);
  assert.ok(index.every((entry) => entry.preview.length <= 110));
  const tokens = estimateTokens(document_.fullText);
  assert.ok(tokens > 1_000 && tokens < 30_000, `estimativa inesperada: ${tokens}`);
});

/* ------------------------------ Normaliza\u00e7\u00e3o ------------------------------ */
console.log('\n[4] Normaliza\u00e7\u00e3o e regra de "n\u00e3o inventar"');

check('valores vazios s\u00e3o tratados como ausentes', () => {
  for (const value of ['', '   ', 'N/A', 'n\u00e3o informado', 'null', null, undefined, '-']) {
    assert.equal(isBlank(value), true, `deveria ser vazio: ${JSON.stringify(value)}`);
    assert.equal(
      normalizeEvidence(value).status,
      'not_found',
      `status incorreto para ${JSON.stringify(value)}`,
    );
  }
});

check('status "found" sem valor \u00e9 rebaixado para "not_found"', () => {
  const evidence = normalizeEvidence({ status: 'found', value: '', quote: 'x' });
  assert.equal(evidence.status, 'not_found');
  assert.equal(evidence.value, null);
});

check('infer\u00eancia exige justificativa expl\u00edcita', () => {
  const evidence = normalizeEvidence({ status: 'inferred', value: '45 dias' });
  assert.equal(evidence.status, 'inferred');
  assert.ok(evidence.reason && evidence.reason.length > 10, 'justificativa obrigat\u00f3ria ausente');
});

check('aceita varia\u00e7\u00f5es de nomes de campo do modelo', () => {
  const evidence = normalizeEvidence({ status: 'found', valor: 'R$ 10,00', pagina: 'P\u00e1gina 4', trecho: 'texto' });
  assert.equal(evidence.value, 'R$ 10,00');
  assert.equal(evidence.source, 'P\u00e1gina 4');
  assert.equal(evidence.quote, 'texto');
});

check('lista com itens vazios e duplicados \u00e9 limpa', () => {
  const analysis = normalizeAnalysis(
    {
      documento: { titulo: 'Teste' },
      resumoExecutivo: { visaoGeral: 'Resumo', destaques: ['a', '', 'A', 'b'] },
      participacao: { documentos: ['RG', 'RG', null, ' '] },
    },
    { dataAnalise: new Date().toISOString(), paginas: 3, caracteres: 100 },
  );
  assert.equal(analysis.resumoExecutivo.destaques.length, 2);
  assert.equal(analysis.participacao.documentos.length, 1);
});

check('resposta vazia ainda produz um relat\u00f3rio v\u00e1lido', () => {
  const analysis = normalizeAnalysis({}, { dataAnalise: new Date().toISOString() });
  assert.equal(analysis.informacoesGerais.orgao.status, 'not_found');
  assert.equal(evidenceText(analysis.informacoesGerais.orgao), NOT_FOUND_LABEL);
  assert.equal(analysis.cronograma.length, 0);
  assert.ok(analysis.conclusao.texto.length > 10);
  assert.doesNotThrow(() => analiseSchema.parse(analysis));
});

check('aceita varia\u00e7\u00f5es de status que o modelo costuma inventar', () => {
  // Regress\u00e3o: um status fora do enum fazia o schema inteiro falhar e
  // descartava toda a an\u00e1lise j\u00e1 paga.
  for (const raw of ['FOUND', 'found ', 'encontrado', 'localizado', 'present', 'INFERRED', 'inferido', 'não identificado', 'ausente']) {
    const analysis = normalizeAnalysis(
      { participacao: { documentos: [{ text: 'Contrato social', status: raw }] } },
      { dataAnalise: new Date().toISOString() },
    );
    assert.equal(analysis.participacao.documentos.length, 1, `status rejeitado: ${raw}`);
    const status = analysis.participacao.documentos[0].status;
    if (status !== undefined) {
      assert.ok(
        ['found', 'inferred', 'not_found'].includes(status),
        `status inv\u00e1lido ap\u00f3s normaliza\u00e7\u00e3o: ${status}`,
      );
    }
  }
});

check('status desconhecido em item de lista \u00e9 descartado sem quebrar a valida\u00e7\u00e3o', () => {
  const analysis = normalizeAnalysis(
    { obrigacoes: { contratada: [{ text: 'Entregar os bens', status: 'parcialmente confirmado' }] } },
    { dataAnalise: new Date().toISOString() },
  );
  assert.equal(analysis.obrigacoes.contratada.length, 1);
  assert.equal(analysis.obrigacoes.contratada[0].status, undefined);
});

check('"found" sem trecho e sem p\u00e1gina vira infer\u00eancia expl\u00edcita', () => {
  const semOrigem = normalizeEvidence({ status: 'found', value: 'R$ 4.800.000,00' });
  assert.equal(semOrigem.status, 'inferred');
  assert.ok(semOrigem.reason && semOrigem.reason.length > 20, 'motivo da infer\u00eancia ausente');

  const comOrigem = normalizeEvidence({
    status: 'found',
    value: 'R$ 4.800.000,00',
    quote: 'valor estimado de R$ 4.800.000,00',
    source: 'P\u00e1gina 5',
  });
  assert.equal(comOrigem.status, 'found');
});

check('payload que n\u00e3o \u00e9 objeto \u00e9 tratado como resposta inv\u00e1lida', () => {
  for (const payload of [[{ a: 1 }], 'texto livre', 42, true]) {
    assert.throws(
      () => normalizeAnalysis(payload, { dataAnalise: new Date().toISOString() }),
      (error) => error && error.code === 'AI_INVALID_RESPONSE',
      `payload n\u00e3o rejeitado: ${JSON.stringify(payload)}`,
    );
  }
  // `null`/`undefined` s\u00e3o respostas vazias leg\u00edtimas (relat\u00f3rio completo s\u00f3 com ausentes).
  assert.doesNotThrow(() => normalizeAnalysis(null, { dataAnalise: new Date().toISOString() }));
});

check('or\u00e7amento do prompt de s\u00edntese respeita a janela de contexto', () => {
  const pequeno = computeReduceBudget({
    partials: 3,
    pageIndexChars: 2_000,
    fixedChars: 12_000,
    contextTokens: 64_000,
    budgetRatio: 0.7,
  });
  assert.equal(pequeno.fits, true);
  assert.ok(pequeno.perPartialChars >= 700);

  const gigante = computeReduceBudget({
    partials: 120,
    pageIndexChars: 90_000,
    fixedChars: 12_000,
    contextTokens: 64_000,
    budgetRatio: 0.7,
  });
  assert.equal(gigante.fits, false, 'documento gigante deveria exceder o or\u00e7amento');
  assert.ok(gigante.perPartialChars >= 700, 'nunca abaixo do m\u00ednimo utiliz\u00e1vel');
});

check('corte de JSON preserva estrutura v\u00e1lida', () => {
  const grande = { itens: Array.from({ length: 200 }, (_, index) => `item ${index} com descri\u00e7\u00e3o longa`), outro: 'x' };
  const texto = buildReduceUserPrompt({
    fileName: 'edital.pdf',
    pages: 40,
    totalChars: 200_000,
    chunkCount: 20,
    pageIndex: [{ page: 1, chars: 2_000, preview: 'previa' }],
    partials: [{ label: 'P\u00e1ginas 1\u20135', pages: [1, 2, 3, 4, 5], data: grande }],
    budget: { perPartialChars: 1_500, indexChars: 200 },
  });

  // Isola exatamente o JSON do bloco 1 (entre o cabe\u00e7alho e a se\u00e7\u00e3o de instru\u00e7\u00f5es).
  const inicio = texto.indexOf('### BLOCO 1');
  const fim = texto.indexOf('\n\n' + REDUCE_MARKER, inicio);
  assert.ok(inicio >= 0, 'bloco 1 ausente no prompt');
  const corpo = texto.slice(inicio, fim > inicio ? fim : undefined);
  const json = corpo.slice(corpo.indexOf('\n') + 1).trim();

  assert.ok(json.startsWith('{') && json.endsWith('}'), 'JSON do bloco n\u00e3o delimitado corretamente');
  assert.doesNotThrow(() => JSON.parse(json), 'JSON recortado inv\u00e1lido');

  const parsed = JSON.parse(json);
  assert.ok(JSON.stringify(parsed).length <= 1_600, 'recorte excedeu o or\u00e7amento informado');
});

check('resposta do modelo entre cercas de c\u00f3digo \u00e9 lida', () => {
  const comCerca = parseModelJson('```json\n{"documento":{"titulo":"Edital"}}\n```');
  assert.equal(comCerca.repaired, false);
  assert.equal(comCerca.data.documento.titulo, 'Edital');

  const comPros = parseModelJson('Segue o JSON solicitado:\n{"a":1}\nQualquer d\u00favida, avise.');
  assert.equal(comPros.repaired, false);
  assert.equal(comPros.data.a, 1);
});

check('resposta cortada no meio de uma string \u00e9 recuperada', () => {
  // Caso real: `finish_reason=length` interrompe o valor de `quote`.
  const truncado =
    '{"documento":{"titulo":"Edital"},"valores":{"valorEstimado":{"status":"found","value":"R$ 1.234,56","quote":"A entrega dos bens dever\u00e1 ocorrer em at\u00e9 45 (quarenta e cinco) dias corrid';
  const parsed = parseModelJson(truncado, { truncated: true });

  assert.equal(parsed.repaired, true, 'truncamento deveria ser sinalizado como reparo');
  assert.equal(parsed.data.documento.titulo, 'Edital');
  assert.equal(parsed.data.valores.valorEstimado.value, 'R$ 1.234,56');
  assert.ok(
    parsed.data.valores.valorEstimado.quote.endsWith('dias corrid'),
    'o trecho parcialmente escrito deveria ser preservado',
  );
});

check('resposta cortada em uma lista descarta apenas o item incompleto', () => {
  const parsed = parseModelJson('{"a":1,"itens":[{"n":1},{"n":2},{"n":', { truncated: true });
  assert.equal(parsed.repaired, true);
  assert.equal(parsed.data.a, 1);
  assert.deepEqual(
    parsed.data.itens.map((item) => item.n),
    [1, 2],
  );
});

check('JSON truncado sem nada recuper\u00e1vel vira erro acion\u00e1vel', () => {
  assert.throws(
    () => parseModelJson('{"documento"', { truncated: true, label: 's\u00edntese final' }),
    (error) => {
      assert.equal(error.code, 'AI_INVALID_RESPONSE');
      assert.match(error.message, /cortada pelo limite de tokens/i);
      assert.match(error.hint, /AI_MAX_OUTPUT_TOKENS/);
      return true;
    },
  );
});

check('JSON inv\u00e1lido sem truncamento mant\u00e9m a mensagem original', () => {
  assert.throws(
    () => parseModelJson('desculpe, n\u00e3o consegui analisar este edital'),
    (error) => {
      assert.equal(error.code, 'AI_INVALID_RESPONSE');
      assert.match(error.message, /n\u00e3o \u00e9 JSON v\u00e1lido/i);
      return true;
    },
  );
  // Sem a marca de truncamento, o reparo n\u00e3o inventa estrutura.
  assert.equal(salvageTruncatedJson('texto sem chaves'), null);
});

check('or\u00e7amento de sa\u00edda cresce e respeita teto e janela de contexto', () => {
  assert.equal(nextOutputBudget({ current: 8_192, ceiling: 65_536 }), 16_384);
  assert.equal(nextOutputBudget({ current: 40_000, ceiling: 65_536 }), 65_536);
  assert.equal(
    nextOutputBudget({ current: 8_192, ceiling: 65_536, contextWindow: 20_000, promptTokens: 9_000 }),
    9_976,
  );
  // Sem espa\u00e7o na janela, n\u00e3o h\u00e1 escalonamento (evita repetir a mesma chamada).
  assert.equal(
    nextOutputBudget({ current: 32_768, ceiling: 65_536, contextWindow: 20_000, promptTokens: 18_000 }),
    32_768,
  );
});

check('or\u00e7amento de sa\u00edda padr\u00e3o comporta o schema completo', () => {
  // Regress\u00e3o do incidente: com o padr\u00e3o antigo de 8192 tokens a resposta de um
  // edital de 8 p\u00e1ginas era cortada no meio e o JSON n\u00e3o fechava.
  assert.ok(
    config.ai.maxOutputTokens >= 16_384,
    `or\u00e7amento padr\u00e3o baixo demais para o schema: ${config.ai.maxOutputTokens}`,
  );
  assert.ok(config.ai.maxOutputTokensCeiling >= config.ai.maxOutputTokens, 'teto menor que o padr\u00e3o');
  assert.ok(config.ai.maxOutputTokenEscalations >= 1, 'sem escalonamento, um corte derruba a an\u00e1lise');
});

check('datas e valores inv\u00e1lidos em listas s\u00e3o descartados', () => {
  const analysis = normalizeAnalysis(
    {
      cronograma: [
        { evento: 'Abertura', data: '22/07/2025' },
        { evento: 'Sem data', data: '' },
        { data: '01/01/2025' },
        'string solta',
      ],
    },
    { dataAnalise: new Date().toISOString() },
  );
  assert.equal(analysis.cronograma.length, 1);
  assert.equal(analysis.cronograma[0].evento, 'Abertura');
});

check('todas as chaves do schema final s\u00e3o preenchidas pelo normalizador', () => {
  // Regress\u00e3o: um campo novo no schema que o normalizador esque\u00e7a de
  // preencher s\u00f3 apareceria em produ\u00e7\u00e3o, como erro de valida\u00e7\u00e3o.
  const empty = normalizeAnalysis({}, { dataAnalise: new Date().toISOString(), paginas: 1, caracteres: 10 });
  const shape = analiseSchema.parse(empty);

  const faltando = [];
  const comparar = (esperado, obtido, caminho) => {
    for (const chave of Object.keys(esperado)) {
      if (!(chave in obtido)) {
        faltando.push(`${caminho}.${chave}`);
        continue;
      }
      const esperadoValor = esperado[chave];
      const obtidoValor = obtido[chave];
      if (
        esperadoValor &&
        typeof esperadoValor === 'object' &&
        !Array.isArray(esperadoValor) &&
        obtidoValor &&
        typeof obtidoValor === 'object'
      ) {
        comparar(esperadoValor, obtidoValor, `${caminho}.${chave}`);
      }
    }
  };

  const referencia = analiseSchema.parse({
    documento: { titulo: 'x', dataAnalise: new Date().toISOString() },
    resumoExecutivo: { visaoGeral: 'x', destaques: [], recomendacao: 'x' },
    informacoesGerais: Object.fromEntries(
      Object.keys(analiseSchema.shape.informacoesGerais.shape).map((key) => [key, { status: 'not_found' }]),
    ),
    cronograma: [],
    objeto: {
      resumo: 'x',
      descricaoDetalhada: 'x',
      itens: [
        {
          numero: '1',
          descricao: 'x',
          quantidade: '1',
          unidade: 'UN',
          valorUnitario: 'R$ 1,00',
          valorTotal: 'R$ 1,00',
          lote: '1',
          especificacoes: 'x',
          source: 'P\u00e1gina 1',
        },
      ],
      lotes: [],
      especificacoesTecnicas: [],
    },
    participacao: {
      consorcio: { status: 'not_found' },
      meEpp: { status: 'not_found' },
    },
    obrigacoes: {
      prazoExecucao: { status: 'not_found' },
      prazoEntrega: { status: 'not_found' },
      subcontratacao: { status: 'not_found' },
    },
    valores: { valorEstimado: { status: 'not_found' }, valorMaximo: { status: 'not_found' } },
    pontosDeAtencao: [],
    checklist: [],
    conclusao: { texto: 'x', proximosPassos: [], limitacoesDaAnalise: [] },
  });

  comparar(referencia, shape, 'analise');
  assert.deepEqual(faltando, [], `campos n\u00e3o preenchidos: ${faltando.join(', ')}`);
});

check('nenhum campo de informa\u00e7\u00e3o fica indefinido (nem string vazia)', () => {
  const empty = normalizeAnalysis({}, { dataAnalise: new Date().toISOString() });
  for (const [campo, valor] of Object.entries(empty.informacoesGerais)) {
    assert.ok(valor && typeof valor === 'object', `campo ${campo} n\u00e3o \u00e9 objeto`);
    assert.ok(
      ['found', 'inferred', 'not_found'].includes(valor.status),
      `campo ${campo} com status inv\u00e1lido: ${valor.status}`,
    );
    if (valor.status === 'not_found') {
      assert.equal(valor.value, null, `campo ${campo} ausente mas com valor`);
      assert.equal(evidenceText(valor), NOT_FOUND_LABEL, `campo ${campo} n\u00e3o usa o r\u00f3tulo padr\u00e3o`);
    }
  }
});

/* ---------------------------- Motor local ---------------------------- */
console.log('\n[5] Motor local de extra\u00e7\u00e3o (modo demonstra\u00e7\u00e3o)');

let localAnalysis;
check('extrai as informa\u00e7\u00f5es essenciais do edital de teste', () => {
  localAnalysis = analyzeLocally(document_, {
    fileName: 'edital-demo.pdf',
    dataAnalise: new Date().toISOString(),
  });

  assert.match(evidenceText(localAnalysis.informacoesGerais.numeroEdital), /042\/2025/);
  assert.match(evidenceText(localAnalysis.informacoesGerais.modalidade), /Preg\u00e3o Eletr\u00f4nico/i);
  assert.match(evidenceText(localAnalysis.informacoesGerais.orgao), /Vale Verde/i);
  assert.match(evidenceText(localAnalysis.valores.valorEstimado), /1\.284\.350,00/);
});

check('constr\u00f3i cronograma com datas v\u00e1lidas e em ordem', () => {
  assert.ok(localAnalysis.cronograma.length >= 3, `esperado >= 3 marcos, obtido ${localAnalysis.cronograma.length}`);
  const toTime = (br) => {
    const [d, m, y] = br.split('/').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const times = localAnalysis.cronograma.map((entry) => toTime(entry.data));
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'cronograma fora de ordem');
  assert.ok(
    localAnalysis.cronograma.some((entry) => entry.data === '22/07/2025'),
    'data de encerramento n\u00e3o encontrada',
  );
  assert.ok(
    localAnalysis.cronograma.every((entry) => /^\d{2}\/\d{2}\/\d{4}$/.test(entry.data)),
    'formato de data inv\u00e1lido',
  );
});

check('lista itens e lotes do objeto', () => {
  assert.ok(localAnalysis.objeto.itens.length >= 8, `esperado >= 8 itens, obtido ${localAnalysis.objeto.itens.length}`);
  assert.ok(localAnalysis.objeto.itens.every((item) => item.descricao.length > 5));
});

check('n\u00e3o cria marcos de cronograma a partir de datas citadas no meio de frases', () => {
  // Regress\u00e3o: "...antes da data de abertura das propostas, ou seja, at\u00e9 17/07/2025"
  // n\u00e3o deve virar um marco "Abertura das propostas" em 17/07.
  const impugnacao = localAnalysis.cronograma.find((entry) => /impugna/i.test(entry.evento));
  assert.ok(impugnacao, 'prazo de impugna\u00e7\u00e3o n\u00e3o identificado');
  assert.equal(impugnacao.data, '17/07/2025');
  assert.equal(impugnacao.hora, '17:00', 'hora do prazo de impugna\u00e7\u00e3o incorreta');

  const aberturas = localAnalysis.cronograma.filter((entry) => /abertura das propostas/i.test(entry.evento));
  assert.ok(aberturas.length >= 1, 'abertura das propostas n\u00e3o identificada');
  assert.ok(
    aberturas.every((entry) => entry.data === '22/07/2025'),
    `abertura associada a data incorreta: ${aberturas.map((entry) => entry.data).join(', ')}`,
  );
  assert.ok(
    !localAnalysis.cronograma.some((entry) => entry.evento === 'Data relevante'),
    'cronograma cont\u00e9m marcos gen\u00e9ricos',
  );
});

check('encontra exig\u00eancias de habilita\u00e7\u00e3o e monta checklist', () => {
  const total =
    (localAnalysis.participacao.qualificacaoTecnica?.length ?? 0) +
    (localAnalysis.participacao.documentos?.length ?? 0) +
    (localAnalysis.participacao.certidoes?.length ?? 0) +
    (localAnalysis.participacao.qualificacaoEconomicoFinanceira?.length ?? 0);
  assert.ok(total >= 4, `poucas exig\u00eancias encontradas: ${total}`);
  assert.ok(localAnalysis.checklist.length >= 10, 'checklist curto demais');
});

check('aponta prazo cr\u00edtico como prioridade alta', () => {
  const critical = localAnalysis.pontosDeAtencao.filter((point) => point.nivel === 'alto');
  assert.ok(critical.length >= 1, 'nenhum ponto de aten\u00e7\u00e3o cr\u00edtico');
  assert.ok(
    critical.some((point) => /prazo/i.test(point.titulo)),
    'prazo n\u00e3o apontado como cr\u00edtico',
  );
});

check('a an\u00e1lise local respeita o schema e declara suas limita\u00e7\u00f5es', () => {
  assert.doesNotThrow(() => analiseSchema.parse(localAnalysis));
  assert.ok(
    localAnalysis.conclusao.limitacoesDaAnalise.some((text) => /local|humana|ia/i.test(text)),
    'limita\u00e7\u00f5es n\u00e3o declaradas',
  );
  assert.equal(localAnalysis.documento.paginas, document_.totalPages);
});

/* ------------------------------- Relat\u00f3rio ------------------------------- */
console.log('\n[6] Relat\u00f3rio em PDF (HTML de impress\u00e3o)');

const meta = { engine: 'local-demo', chunks: 1, llmCalls: 0, tokensEstimados: 0, avisos: ['aviso de teste'] };

check('gera HTML autocontido com as 10 se\u00e7\u00f5es', () => {
  const html = renderReportHtml(localAnalysis, meta);
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'n\u00e3o \u00e9 um documento HTML');
  assert.ok(html.includes('@page'), 'regras de impress\u00e3o ausentes');
  assert.ok(html.includes('Resumo Executivo'));
  assert.ok(html.includes('Informa\u00e7\u00f5es Gerais'));
  assert.ok(html.includes('Cronograma'));
  assert.ok(html.includes('Objeto da Licita\u00e7\u00e3o'));
  assert.ok(html.includes('Requisitos para Participa\u00e7\u00e3o'));
  assert.ok(html.includes('Obriga\u00e7\u00f5es'));
  assert.ok(html.includes('Valores'));
  assert.ok(html.includes('Pontos de Aten\u00e7\u00e3o'));
  assert.ok(html.includes('Checklist de Participa\u00e7\u00e3o'));
  assert.ok(html.includes('Conclus\u00e3o'));
  assert.ok(!html.includes('<script'), 'HTML n\u00e3o deve conter scripts');
});

check('escapa conte\u00fado perigoso (prote\u00e7\u00e3o contra inje\u00e7\u00e3o)', () => {
  const hostile = normalizeAnalysis(
    {
      resumoExecutivo: { visaoGeral: '<script>alert(1)</script>', destaques: ['<img src=x onerror=alert(1)>'] },
      documento: { titulo: '"><script>' },
    },
    { dataAnalise: new Date().toISOString() },
  );
  const html = renderReportHtml(hostile, meta);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'script n\u00e3o escapado');
  assert.ok(!html.includes('onerror=alert(1)>'), 'atributo de evento n\u00e3o escapado');
  assert.ok(html.includes('&lt;script&gt;'), 'esperado escape HTML');
});

check('usa o r\u00f3tulo padr\u00e3o em vez de campo vazio', () => {
  const empty = normalizeAnalysis({}, { dataAnalise: new Date().toISOString() });
  const html = renderReportHtml(empty, meta);
  assert.ok(html.includes(NOT_FOUND_LABEL), 'r\u00f3tulo de ausente n\u00e3o encontrado no relat\u00f3rio');
});

check('nome do arquivo de sa\u00edda \u00e9 seguro e descritivo', () => {
  const name = reportFileName(localAnalysis);
  assert.match(name, /^analise-edital-[a-z0-9-]+\.pdf$/);
  assert.ok(name.length < 80);
});

/* ------------------------------- Valida\u00e7\u00e3o ------------------------------ */
console.log('\n[7] Valida\u00e7\u00e3o de upload');

check('rejeita arquivo que n\u00e3o \u00e9 PDF', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'documento.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.throws(() => validateUpload(file, Buffer.from([1, 2, 3])), /PDF/i);
});

check('rejeita arquivo acima do limite de tamanho', () => {
  const big = Buffer.alloc(30 * 1024 * 1024);
  const file = new File([new Uint8Array(1)], 'grande.pdf', { type: 'application/pdf' });
  assert.throws(() => validateUpload(file, big), /limite|MB/i);
});

check('aceita PDF v\u00e1lido', () => {
  const file = new File([new Uint8Array(1)], 'edital.pdf', { type: 'application/pdf' });
  assert.doesNotThrow(() => validateUpload(file, Buffer.alloc(1024)));
});

await checkAsync('rejeita PDF corrompido com erro tratado (sem quebrar a aplica\u00e7\u00e3o)', async () => {
  const corrupted = Buffer.from('%PDF-1.4\nconteudo invalido sem estrutura de objetos\n%%EOF', 'latin1');
  await assert.rejects(
    () => extractDocument(corrupted),
    (error) => Boolean(error && typeof error === 'object' && 'code' in error && 'status' in error),
    'esperado AppError com c\u00f3digo e status',
  );
});

/* ------------------------ Plataforma de licitações ------------------------ */
console.log('\n── Plataforma ─────────────────────────────────────────────────');

const { contemTermo, normalizar, palavrasChave, itemCasa } = await load('plataforma/texto.js');
const { calcularAderencia } = await load('plataforma/aderencia.js');
const { estatisticasPrecos } = await load('plataforma/precos.js');
const { situacaoDocumento, prontidaoDocumental, renovarDocumento, valorEmDisputa, novoCard } = await load('plataforma/workspace.js');
const { eventosAgenda, eventosFuturos } = await load('plataforma/agenda.js');
const { toIsoBrasilia } = await load('pncp/api.js');

const AGORA = Date.parse('2026-09-22T15:00:00-03:00');
const DIA = 86_400_000;
const perfilBase = {
  termos: ['notebook', 'monitor'],
  termosExcluir: ['locação'],
  ufs: ['SP', 'MG'],
  modalidades: [6],
  valorMin: 10_000,
  valorMax: 500_000,
};
const oportunidade = (extra = {}) => ({
  id: '00000000000100-2026-1',
  cnpj: '00000000000100',
  ano: '2026',
  sequencial: '1',
  numeroControle: '',
  titulo: 'Edital nº 1/2026',
  objeto: 'Aquisição de notebooks e monitores para a secretaria',
  orgao: 'MUNICIPIO X',
  unidade: '',
  municipio: 'Campinas',
  uf: 'SP',
  esfera: 'Municipal',
  modalidadeId: 6,
  modalidade: 'Pregão eletrônico',
  situacao: '',
  publicadaEm: null,
  aberturaPropostas: null,
  encerramentoPropostas: new Date(AGORA + 12 * DIA).toISOString(),
  valorEstimado: 120_000,
  temResultado: false,
  cancelado: false,
  linkPncp: '',
  ...extra,
});

check('texto: normaliza acentos e casa só no início de palavra', () => {
  assert.equal(normalizar('Informática  Básica!'), 'informatica basica');
  assert.ok(contemTermo(normalizar('Aquisição de notebooks'), 'notebook'));
  assert.ok(!contemTermo(normalizar('anotação de campo'), 'nota'));
  assert.deepEqual(palavrasChave('papel A4 para impressora'), ['papel', 'a4', 'impressora']);
});

check('preços: item casa só quando o termo abre a descrição', () => {
  const palavras = palavrasChave('notebook');
  assert.ok(itemCasa('Notebook IdeaPad 3, 16 GB', palavras));
  assert.ok(itemCasa('Lote 1 - NOTEBOOK BÁSICO', palavras));
  assert.ok(!itemCasa('Base cooler vertical para notebook', palavras));
  assert.ok(!itemCasa('Carregador de bateria para notebook', palavras));
});

check('aderência: 2 termos no objeto = 37,5 de 45; 3 termos fecham 100', () => {
  const aderencia = calcularAderencia(oportunidade(), perfilBase, AGORA);
  assert.equal(aderencia.nota, 93);
  assert.equal(aderencia.fatores.find((fator) => fator.id === 'objeto').pontos, 37.5);
  const completo = calcularAderencia(oportunidade(), { ...perfilBase, termos: [...perfilBase.termos, 'secretaria'] }, AGORA);
  assert.equal(completo.nota, 100);
  assert.equal(aderencia.faixa, 'alta');
  assert.deepEqual(aderencia.termosEncontrados, ['notebook', 'monitor']);
  assert.equal(aderencia.fatores.reduce((total, fator) => total + fator.max, 0), 100);
});

check('aderência: termo excluído derruba a nota e explica o motivo', () => {
  const aderencia = calcularAderencia(oportunidade({ objeto: 'Locação de notebooks' }), perfilBase, AGORA);
  assert.ok(aderencia.nota <= 10);
  assert.match(aderencia.bloqueio ?? '', /locação/);
});

check('aderência: sem termo no objeto, nota limitada a 35', () => {
  const aderencia = calcularAderencia(oportunidade({ objeto: 'Aquisição de merenda escolar' }), perfilBase, AGORA);
  assert.ok(aderencia.nota <= 35);
  assert.equal(aderencia.faixa, 'baixa');
});

check('aderência: fora da UF, acima da capacidade e prazo curto perdem pontos', () => {
  const aderencia = calcularAderencia(
    oportunidade({ uf: 'RS', valorEstimado: 2_000_000, encerramentoPropostas: new Date(AGORA + 2 * DIA).toISOString() }),
    perfilBase,
    AGORA,
  );
  const pontos = Object.fromEntries(aderencia.fatores.map((fator) => [fator.id, fator.pontos]));
  assert.equal(pontos.regiao, 0);
  assert.equal(pontos.valor, 3);
  assert.equal(pontos.prazo, 6);
});

check('aderência: valor não informado é neutro (7 de 15)', () => {
  const aderencia = calcularAderencia(oportunidade({ valorEstimado: null }), perfilBase, AGORA);
  assert.equal(aderencia.fatores.find((fator) => fator.id === 'valor').pontos, 7);
});

let sequenciaAmostra = 0;
const amostra = (valor, extra = {}) => ({
  id: `a-${(sequenciaAmostra += 1)}`,
  descricao: 'Notebook',
  unidade: 'UN',
  quantidade: 1,
  valorEstimadoUnitario: valor * 1.2,
  valorHomologadoUnitario: valor,
  desconto: 16.7,
  fornecedor: 'Fornecedor',
  documentoFornecedor: String(valor),
  porte: 'ME',
  dataResultado: null,
  orgao: '',
  municipio: '',
  uf: 'SP',
  modalidade: '',
  linkPncp: '',
  ...extra,
});

check('preços: mediana, quartis e unidade predominante', () => {
  const stats = estatisticasPrecos([amostra(100), amostra(200), amostra(300), amostra(400), amostra(9, { unidade: 'CX' })]);
  assert.equal(stats.unidade, 'UN');
  assert.equal(stats.amostras, 4);
  assert.equal(stats.descartadasPorUnidade, 1);
  assert.equal(stats.mediana, 250);
  assert.equal(stats.p25, 175);
  assert.equal(stats.faixas.reduce((total, faixa) => total + faixa.quantidade, 0), 4);
  assert.equal(stats.participacaoMeEpp, 1);
});

check('preços: "Unidade", "UND" e "UN" são a mesma unidade; lista vazia não gera estatística', () => {
  const stats = estatisticasPrecos([amostra(1, { unidade: 'Unidade' }), amostra(2, { unidade: 'UND' }), amostra(3)]);
  assert.equal(stats.amostras, 3);
  assert.equal(estatisticasPrecos([]), null);
});

const documento = (validade, extra = {}) => ({
  id: 'd',
  nome: 'CND',
  categoria: 'fiscal',
  emissor: '',
  emissao: null,
  validade,
  validadePadraoDias: 30,
  linkEmissao: null,
  observacao: '',
  ...extra,
});

check('documentos: vencido, a vencer, válido e sem validade', () => {
  assert.equal(situacaoDocumento(documento('2026-09-20'), AGORA).situacao, 'vencido');
  assert.deepEqual(situacaoDocumento(documento('2026-09-22'), AGORA), { situacao: 'a-vencer', dias: 0 });
  assert.equal(situacaoDocumento(documento('2026-10-01'), AGORA).situacao, 'a-vencer');
  assert.equal(situacaoDocumento(documento('2026-12-31'), AGORA).situacao, 'valido');
  assert.equal(situacaoDocumento(documento(null), AGORA).situacao, 'permanente');
});

check('documentos: prontidão e renovação pela validade usual', () => {
  assert.equal(prontidaoDocumental([documento('2026-09-20'), documento('2026-12-31')], AGORA), 50);
  const renovado = renovarDocumento(documento('2026-09-20'), AGORA);
  assert.equal(renovado.emissao, '2026-09-22');
  assert.equal(renovado.validade, '2026-10-22');
});

check('pipeline e agenda: valor em disputa e só eventos futuros', () => {
  const ativo = novoCard(oportunidade({ aberturaPropostas: new Date(AGORA - DIA).toISOString() }), 'proposta', AGORA);
  ativo.valorProposta = 100_000;
  const encerrado = { ...novoCard(oportunidade(), 'resultado', AGORA), id: 'outro' };
  assert.equal(valorEmDisputa([ativo, encerrado]), 100_000);

  const ws = { versao: 1, perfil: {}, pipeline: [ativo, encerrado], documentos: [documento('2026-10-01')], descartadas: [], criadoEm: '' };
  const eventos = eventosAgenda(ws);
  assert.deepEqual(eventos.map((evento) => evento.tipo).sort(), ['abertura', 'documento', 'encerramento']);
  // A abertura de ontem já passou; o fim das propostas e o vencimento do documento continuam.
  assert.deepEqual(eventosFuturos(eventos, AGORA).map((evento) => evento.tipo).sort(), ['documento', 'encerramento']);
});

check('PNCP: datas sem fuso são interpretadas no horário de Brasília', () => {
  assert.equal(toIsoBrasilia('2026-10-06T09:00'), '2026-10-06T12:00:00.000Z');
  assert.equal(toIsoBrasilia('2026-09-22T16:28:47.577815858'), '2026-09-22T19:28:47.000Z');
  assert.equal(toIsoBrasilia(null), null);
});

/* -------------------------------- Resumo -------------------------------- */
rmSync(workDir, { recursive: true, force: true });

console.log(
  `\n\u2500\u2500 Resultado: ${passed} teste(s) aprovado(s), ${failures.length} falha(s) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n`,
);

if (failures.length) {
  for (const failure of failures) {
    console.error(`\u2717 ${failure.name}\n${failure.error.stack}\n`);
  }
  process.exit(1);
}
