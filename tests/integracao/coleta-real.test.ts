/**
 * Integração REAL: consulta as APIs públicas do PNCP e do Compras.gov.br ao vivo e grava no
 * PostgreSQL de teste. Requer rede. Volume limitado (poucas páginas) para não sobrecarregar as fontes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coletarFonte, TIPO_PROCESSAR } from '../../src/coleta/coletor.js';
import { processarOportunidade } from '../../src/coleta/processador.js';
import { ConectorComprasGov } from '../../src/conectores/comprasgov/conector.js';
import { ConectorPncp } from '../../src/conectores/pncp/conector.js';
import { ConectorSigaRj } from '../../src/conectores/siga-rj/conector.js';
import { carregarConfig } from '../../src/config/index.js';
import { Oportunidade } from '../../src/contrato/oportunidade.js';
import { Dicionario } from '../../src/dicionario/dicionario.js';
import { obterOportunidade } from '../../src/repositorio/consultas.js';
import { salvarOportunidade } from '../../src/repositorio/oportunidades.js';
import { criarExecutor, executarCiclo } from '../../src/worker.js';
import { fecharPool, obterPool, prepararBanco } from './preparar.js';

// Dicionário amplo de TESTE para garantir capturas; não é o dicionário comercial da Nett.
const dicionarioTeste = new Dicionario({
  versao: 'teste-integracao',
  oficial: false,
  termos: [{ termo: 'aquisicao', sinonimos: ['contratacao', 'registro de precos', 'servicos', 'fornecimento'] }],
  exclusoes: [],
});

const REFERENCIA = new Date('2026-11-12T15:00:00Z');
const T = 600_000;

beforeAll(prepararBanco);
afterAll(fecharPool);

describe('PNCP ao vivo', () => {
  const pncp = new ConectorPncp([6]);

  it('pagina, normaliza, filtra pelo dicionário, persiste e enfileira', async () => {
    const r = await coletarFonte(pncp, dicionarioTeste, { referencia: REFERENCIA, janelaDias: 0, maxPaginas: 2 });
    expect(r.execucaoId).toBeTypeOf('number');
    expect(r.contadores.paginas_lidas).toBe(2);
    expect(r.contadores.registros_lidos).toBe(100);
    expect(r.contadores.novas).toBeGreaterThan(0);
    expect(r.contadores.enfileiradas).toBe(r.contadores.novas);
    expect(r.pendencias).toEqual(['atualizacao:6:2026-11-12@3']); // limite operacional: nada descartado, cursor guardado
    const exec = (await obterPool().query('SELECT * FROM integracao.execucao_coleta WHERE id = $1', [r.execucaoId])).rows[0];
    expect(exec).toMatchObject({ fonte_id: 'pncp', status: 'parcial', paginas_lidas: 2, registros_lidos: 100 });
    expect(exec.duracao_ms).toBeGreaterThan(0);
    const cursor = (await obterPool().query(`SELECT * FROM integracao.coleta_cursor WHERE fonte_id = 'pncp'`)).rows[0];
    expect(cursor).toMatchObject({ chave: 'atualizacao:6:2026-11-12', pagina_concluida: 2, fechado: false });
    expect(cursor.total_paginas).toBeGreaterThan(2);
  }, T);

  it('retoma do cursor sem duplicar oportunidades', async () => {
    const antes = (await obterPool().query('SELECT count(*)::int AS n FROM integracao.oportunidade')).rows[0].n;
    const r = await coletarFonte(pncp, dicionarioTeste, { referencia: REFERENCIA, janelaDias: 0, maxPaginas: 2 });
    // Relê a página 2 (pode ter crescido) e avança para a 3.
    expect(r.contadores.inalteradas).toBeGreaterThan(0);
    const cursor = (await obterPool().query(`SELECT pagina_concluida FROM integracao.coleta_cursor WHERE fonte_id = 'pncp'`)).rows[0];
    expect(cursor.pagina_concluida).toBe(3);
    const depois = (await obterPool().query('SELECT count(*)::int AS n FROM integracao.oportunidade')).rows[0].n;
    expect(depois).toBe(antes + r.contadores.novas);
    const dup = (await obterPool().query('SELECT count(*)::int AS n FROM (SELECT chave_canonica FROM integracao.oportunidade GROUP BY 1 HAVING count(*) > 1) x')).rows[0].n;
    expect(dup).toBe(0);
  }, T);

  it('processa uma oportunidade real: documentos e itens do PNCP + contrato válido', async () => {
    const { rows } = await obterPool().query(`SELECT id FROM integracao.oportunidade WHERE numero_controle_pncp IS NOT NULL ORDER BY primeira_coleta_em LIMIT 1`);
    const r = await processarOportunidade(pncp, rows[0].id);
    expect(r.itens).toBeGreaterThan(0);
    const op = (await obterOportunidade(rows[0].id))!;
    expect(() => Oportunidade.parse(op)).not.toThrow();
    expect(op.statusProcessamento).toBe('processada');
    expect(op.itens.length).toBe(r.itens);
    expect(op.documentos.length).toBe(r.documentos);
    for (const d of op.documentos) expect(d.url).toMatch(/^https:\/\/pncp\.gov\.br\//);
  }, T);
});

describe('Compras.gov.br ao vivo', () => {
  const cg = new ConectorComprasGov([5]);

  it('coleta fonte independente e deduplica com o PNCP pelo número de controle', async () => {
    const r = await coletarFonte(cg, dicionarioTeste, { referencia: REFERENCIA, janelaDias: 0, maxPaginas: 1 });
    expect(r.contadores.paginas_lidas).toBe(1);
    expect(r.contadores.registros_lidos).toBeGreaterThan(0);
    expect(r.contadores.novas + r.contadores.atualizadas + r.contadores.inalteradas).toBe(r.contadores.registros_aderentes);

    // Busca no PNCP as mesmas compras vistas pelo Compras.gov: devem cair na MESMA oportunidade.
    const pncp = new ConectorPncp([6]);
    const { rows } = await obterPool().query(
      `SELECT o.id, o.numero_controle_pncp FROM integracao.oportunidade o
         JOIN integracao.oportunidade_fonte f ON f.oportunidade_id = o.id AND f.fonte_id = 'comprasgov'
        WHERE o.numero_controle_pncp IS NOT NULL LIMIT 3`,
    );
    expect(rows.length).toBeGreaterThan(0);
    let mescladas = 0;
    for (const linha of rows) {
      const viaPncp = await pncp.obterCompra(linha.numero_controle_pncp);
      if (!viaPncp) continue;
      const salvo = await salvarOportunidade(viaPncp, ['aquisicao']);
      expect(salvo.oportunidadeId).toBe(linha.id);
      mescladas += 1;
    }
    expect(mescladas).toBeGreaterThan(0);
    const origens = (await obterPool().query(
      `SELECT count(*)::int AS n FROM (SELECT oportunidade_id FROM integracao.oportunidade_fonte GROUP BY 1 HAVING count(DISTINCT fonte_id) = 2) x`,
    )).rows[0].n;
    expect(origens).toBeGreaterThanOrEqual(mescladas);
  }, T);
});

describe('SIGA/RJ', () => {
  it('reporta indisponibilidade explícita, sem dados simulados', async () => {
    const r = await coletarFonte(new ConectorSigaRj(false), dicionarioTeste, { janelaDias: 0, maxPaginas: 1 });
    expect(r.status).toBe('indisponivel');
    expect(r.pendencias[0]).toMatch(/forma de acesso autorizada/);
  });
});

describe('worker', () => {
  it('processa a fila respeitando o limite por hora (excedente permanece pendente)', async () => {
    const config = carregarConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL!, PROCESSAMENTO_LIMITE_HORA: '3' });
    const pendentesAntes = (await obterPool().query(`SELECT count(*)::int AS n FROM integracao.fila_job WHERE tipo = $1 AND status = 'pendente'`, [TIPO_PROCESSAR])).rows[0].n;
    expect(pendentesAntes).toBeGreaterThan(3);
    // Simula as 0 concluídas na última hora + o job já processado manualmente não conta (não passou pela fila).
    const executar = criarExecutor(config);
    let total = 0;
    for (let i = 0; i < 5; i += 1) total += await executarCiclo(config, executar, 10);
    expect(total).toBe(3);
    const { rows } = await obterPool().query(`SELECT status, count(*)::int AS n FROM integracao.fila_job WHERE tipo = $1 GROUP BY 1`, [TIPO_PROCESSAR]);
    const por = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect(por.concluido).toBe(3);
    expect(por.pendente).toBe(pendentesAntes - 3);
  }, T);
});
