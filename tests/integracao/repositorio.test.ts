import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import comprasgov from '../fixtures/comprasgov-contratacoes-amostra.json' with { type: 'json' };
import pncp from '../fixtures/pncp-atualizacao-amostra.json' with { type: 'json' };
import { normalizarCompraPncp, type CompraPncpRaw } from '../../src/conectores/pncp/conector.js';
import { normalizarContratacaoComprasGov, type ContratacaoComprasGovRaw } from '../../src/conectores/comprasgov/conector.js';
import { Oportunidade } from '../../src/contrato/oportunidade.js';
import { obterOportunidade } from '../../src/repositorio/consultas.js';
import { salvarEnriquecimento, salvarOportunidade } from '../../src/repositorio/oportunidades.js';
import { fecharPool, obterPool, prepararBanco } from './preparar.js';

beforeAll(prepararBanco);
afterAll(fecharPool);

const base = normalizarCompraPncp((pncp.data as CompraPncpRaw[])[0]!)!;

describe('persistência, histórico e deduplicação', () => {
  it('cria, ignora repetição idêntica e versiona alterações', async () => {
    const a = await salvarOportunidade(base, ['software']);
    expect(a.resultado).toBe('nova');
    const b = await salvarOportunidade(base, ['software']);
    expect(b).toMatchObject({ resultado: 'inalterada', oportunidadeId: a.oportunidadeId, versao: 1 });
    const c = await salvarOportunidade({ ...base, situacao: 'Revogada', cancelada: true, valorEstimado: 999.5 }, ['software']);
    expect(c).toMatchObject({ resultado: 'atualizada', versao: 2 });

    const op = (await obterOportunidade(a.oportunidadeId))!;
    expect(() => Oportunidade.parse(op)).not.toThrow();
    expect(op.historico.map((h) => h.tipo)).toEqual(['criacao', 'atualizacao']);
    expect(op.historico[1]!.camposAlterados).toMatchObject({ situacao: { para: 'Revogada' }, valor_estimado: { para: 999.5 }, cancelada: { de: false, para: true } });
    expect(op.origens).toHaveLength(1);
    const { rows } = await obterPool().query('SELECT vezes_vista FROM integracao.oportunidade_fonte WHERE oportunidade_id = $1', [a.oportunidadeId]);
    expect(rows[0].vezes_vista).toBe(3);
  });

  it('mescla PNCP e Compras.gov pela chave canônica, preservando as duas origens', async () => {
    const rawCg = (comprasgov.resultado as ContratacaoComprasGovRaw[])[1]!;
    const cg = normalizarContratacaoComprasGov(rawCg)!;
    const doCg = await salvarOportunidade(cg, ['computadores']);
    expect(doCg.resultado).toBe('nova');
    // Mesma compra vista pelo PNCP, com objeto revisado: PNCP tem prioridade.
    const viaPncp = { ...cg, fonte: 'pncp' as const, idExterno: cg.numeroControlePncp!, objeto: `${cg.objeto} (revisado)`, bruto: { origem: 'pncp' } };
    const doPncp = await salvarOportunidade(viaPncp, ['software']);
    expect(doPncp).toMatchObject({ oportunidadeId: doCg.oportunidadeId, resultado: 'atualizada' });
    // Compras.gov depois não sobrescreve o que o PNCP definiu.
    const deNovo = await salvarOportunidade({ ...cg, objeto: 'outro texto' }, []);
    expect(deNovo.resultado).toBe('inalterada');
    const op = (await obterOportunidade(doCg.oportunidadeId))!;
    expect(op.objeto).toBe(`${cg.objeto} (revisado)`);
    expect(op.origens.map((o) => o.fonte).sort()).toEqual(['comprasgov', 'pncp']);
    expect(op.termosDicionario).toEqual(['computadores', 'software']);
  });

  it('sinaliza possível duplicata sem mesclar', async () => {
    const outra = { ...base, numeroControlePncp: null, fonte: 'siga_rj' as const, idExterno: 'SIGA-1', processo: 'outro', objeto: base.objeto };
    const r = await salvarOportunidade(outra, ['x']);
    expect(r.resultado).toBe('nova');
    const { rows } = await obterPool().query('SELECT motivo, similaridade FROM integracao.possivel_duplicata');
    expect(rows).toEqual([{ motivo: 'mesmo_orgao_objeto_similar', similaridade: 1 }]);
  });

  it('salva documentos e itens, inativa documento removido e emite evento ao Agente 03', async () => {
    const { oportunidadeId } = await salvarOportunidade(base, []);
    const doc = { fonte: 'pncp' as const, titulo: 'Edital', tipo: 'Edital', url: 'https://pncp.gov.br/pncp-api/v1/x/arquivos/1', publicadoEm: null };
    await salvarEnriquecimento(oportunidadeId, [{ ...doc, idExterno: '1' }, { ...doc, idExterno: '2' }], [
      { numero: 1, descricao: 'Item', tipo: 'material', quantidade: 2, unidade: 'UN', valorUnitarioEstimado: 10, valorTotalEstimado: 20 },
    ]);
    await salvarEnriquecimento(oportunidadeId, [{ ...doc, idExterno: '1' }], []);
    const op = (await obterOportunidade(oportunidadeId))!;
    expect(op.statusProcessamento).toBe('processada');
    expect(op.documentos.map((d) => d.idExterno)).toEqual(['1']);
    expect(op.itens).toHaveLength(1);
    const { rows } = await obterPool().query(`SELECT count(*)::int AS n FROM integracao.evento_saida WHERE tipo = 'oportunidade.pronta_para_avaliacao' AND agregado_id = $1`, [oportunidadeId]);
    expect(rows[0].n).toBe(2);
  });
});
