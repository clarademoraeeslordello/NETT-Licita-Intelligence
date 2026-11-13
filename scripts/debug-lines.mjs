/** Inspeção pontual: mostra as linhas extraídas que contêm uma data. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = join(process.cwd(), '.test-build');
const { extractDocument } = await import(pathToFileURL(join(OUT, 'pdf/extract.js')).href);

const buffer = readFileSync(join(process.cwd(), 'test-output', 'edital-demo.pdf'));
const doc = await extractDocument(buffer);

const alvo = process.argv[2] ?? '17/07/2025';
for (const page of doc.pages) {
  for (const line of page.text.split('\n')) {
    if (line.includes(alvo)) {
      console.log(`p.${page.page}: ${JSON.stringify(line)}`);
    }
  }
}
