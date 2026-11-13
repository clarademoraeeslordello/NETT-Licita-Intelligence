/**
 * Captura uma amostra REAL do PNCP e grava em src/lib/fixtures/pncp-amostra.json.
 *
 * A amostra é o plano B da plataforma: entra em cena quando o PNCP está fora do
 * ar (a interface avisa que é amostra) e monta o pipeline de exemplo da primeira
 * visita. Usa as rotas da própria aplicação, então o servidor precisa estar no ar:
 *
 *   npm run dev
 *   node scripts/capturar-amostra-pncp.mjs [http://localhost:3000]
 *
 * O PNCP bloqueia o IP temporariamente sob carga — o script faz poucas chamadas,
 * em sequência.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const DESTINO = join(process.cwd(), 'src', 'lib', 'fixtures', 'pncp-amostra.json');

const TERMOS = ['notebook', 'computador', 'monitor', 'impressora', 'equipamentos de informática'];
const UFS = ['SP', 'MG', 'PR', 'RJ'];
const CONSULTAS_PRECO = ['notebook', 'monitor'];
const MAX_OPORTUNIDADES = 24;

async function json(caminho) {
  const res = await fetch(`${BASE}${caminho}`);
  if (!res.ok) throw new Error(`${caminho} → HTTP ${res.status}`);
  return res.json();
}

async function ndjson(caminho) {
  const res = await fetch(`${BASE}${caminho}`);
  const texto = await res.text();
  return texto.split('\n').filter(Boolean).map((linha) => JSON.parse(linha));
}

console.log(`Radar em ${BASE}…`);
const radar = await json(`/api/radar?termos=${encodeURIComponent(TERMOS.join(','))}&ufs=${UFS.join(',')}&modalidades=6,8`);
if (radar.fonte !== 'pncp') throw new Error('O radar respondeu com a amostra, não com o PNCP ao vivo. Tente mais tarde.');

// Prioriza editais com mais termos e prazo mais longo: a amostra envelhece melhor.
const escolhidas = radar.oportunidades
  .filter((op) => op.termos.length > 0)
  .sort((a, b) => b.termos.length - a.termos.length || (b.encerramentoPropostas ?? '').localeCompare(a.encerramentoPropostas ?? ''))
  .slice(0, MAX_OPORTUNIDADES);

for (let i = 0; i < escolhidas.length; i += 6) {
  const lote = escolhidas.slice(i, i + 6);
  const { valores } = await json(`/api/pncp/valores?ids=${lote.map((op) => op.id).join(',')}`);
  for (const op of lote) op.valorEstimado = valores[op.id] ?? null;
  console.log(`  valores ${Math.min(i + 6, escolhidas.length)}/${escolhidas.length}`);
}

const oportunidades = escolhidas.map(({ termos: _termos, ...op }) => op);

const precos = {};
for (const consulta of CONSULTAS_PRECO) {
  console.log(`Preços de "${consulta}"…`);
  const eventos = await ndjson(`/api/precos?q=${encodeURIComponent(consulta)}`);
  const amostras = eventos.filter((evento) => evento.tipo === 'amostras').flatMap((evento) => evento.amostras);
  precos[consulta] = amostras;
  console.log(`  ${amostras.length} amostra(s)`);
}

writeFileSync(DESTINO, `${JSON.stringify({ capturadoEm: new Date().toISOString(), oportunidades, precos }, null, 1)}\n`);
console.log(`\n${oportunidades.length} oportunidades e ${Object.values(precos).flat().length} preços gravados em ${DESTINO}`);
