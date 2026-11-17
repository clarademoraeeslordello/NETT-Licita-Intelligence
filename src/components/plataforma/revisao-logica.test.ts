import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { reviewInput } from '@/contracts/api/reviews';
import { resolvePath } from '../../server/analysis/reviews/service';
import { blocosEvidencia, corpoDaRevisao, montarCorrecao, resolverDecisao } from './revisao-logica';

const resultado = {
  informacoesGerais: {
    orgao: { status: 'found', value: 'Prefeitura de Exemplo', quote: 'PREFEITURA DE EXEMPLO', source: 'p. 1' },
    modalidade: { status: 'not_found', value: null },
    objeto: { status: 'inferred', value: 'Licenças de software', reason: 'citado no anexo' },
    processo: { status: 'not_found' }, // sem a chave `value`
  },
  valores: { valorEstimado: { status: 'found', value: 1500.5, quote: 'R$ 1.500,50', source: 'p. 3' } },
  obrigacoes: {},
  participacao: {},
};
const uuid = '0190f5e2-7c1a-7cc3-9d2b-000000000001';

describe('blocosEvidencia', () => {
  const blocos = blocosEvidencia(resultado);
  test('lista só campos que têm a chave `value` (o servidor recusa caminho inexistente)', () => {
    assert.deepEqual(blocos.map((b) => b.path), ['informacoesGerais.orgao.value', 'informacoesGerais.modalidade.value', 'informacoesGerais.objeto.value', 'valores.valorEstimado.value']);
  });
  test('todo caminho oferecido existe no resultado, como resolvePath do servidor exige', () => {
    for (const b of blocos) assert.equal(resolvePath(resultado, b.path).found, true, b.path);
  });
  test('traz status, trecho, fonte e motivo; entrada inesperada não quebra', () => {
    assert.deepEqual(blocos[0], { path: 'informacoesGerais.orgao.value', rotulo: 'Órgão', status: 'found', valor: 'Prefeitura de Exemplo', trecho: 'PREFEITURA DE EXEMPLO', fonte: 'p. 1', motivo: null });
    assert.equal(blocos[2]!.motivo, 'citado no anexo');
    assert.deepEqual(blocosEvidencia(null), []);
    assert.deepEqual(blocosEvidencia('lixo'), []);
    assert.deepEqual(blocosEvidencia({ informacoesGerais: { orgao: 5 } }), []);
  });
});

describe('montarCorrecao', () => {
  const orgao = { path: 'informacoesGerais.orgao.value', valor: 'Prefeitura de Exemplo' as string | number | null };
  test('sem mudança → null (nunca correção vazia)', () => {
    assert.equal(montarCorrecao(orgao, 'Prefeitura de Exemplo'), null);
    assert.equal(montarCorrecao(orgao, '  Prefeitura de Exemplo  '), null);
    assert.equal(montarCorrecao({ path: 'x.value', valor: null }, ''), null);
  });
  test('texto novo; vazio vira null; nota em branco vira null', () => {
    assert.deepEqual(montarCorrecao(orgao, 'Prefeitura de Outro Lugar', '  '), { path: orgao.path, previous: 'Prefeitura de Exemplo', corrected: 'Prefeitura de Outro Lugar', note: null });
    assert.equal(montarCorrecao(orgao, '')!.corrected, null);
    assert.equal(montarCorrecao(orgao, 'x', 'conferi no PDF')!.note, 'conferi no PDF');
  });
  test('valor numérico continua numérico quando o texto é um número simples', () => {
    const valor = { path: 'valores.valorEstimado.value', valor: 1500.5 as string | number | null };
    assert.equal(montarCorrecao(valor, '1600.25')!.corrected, 1600.25);
    assert.equal(montarCorrecao(valor, '1500.5'), null);
    assert.equal(montarCorrecao(valor, 'sigiloso')!.corrected, 'sigiloso');
  });
});

describe('decisão e corpo enviado ao servidor', () => {
  test('aprovar sem correções → approved; com correções → approved_with_changes', () => {
    assert.equal(resolverDecisao('approve', 0, '').decisao, 'approved');
    assert.equal(resolverDecisao('approve', 2, '').decisao, 'approved_with_changes');
  });
  test('rejeitar exige comentário', () => {
    assert.deepEqual(resolverDecisao('reject', 0, '  '), { decisao: 'rejected', podeEnviar: false, motivo: 'Explique o motivo da rejeição.' });
    assert.equal(resolverDecisao('reject', 0, 'fora do escopo').podeEnviar, true);
  });
  test('o corpo montado passa no schema do servidor (reviewInput) em todos os caminhos', () => {
    const c = montarCorrecao({ path: 'informacoesGerais.orgao.value', valor: 'A' }, 'B')!;
    for (const corpo of [corpoDaRevisao(uuid, 'approve', [], ''), corpoDaRevisao(uuid, 'approve', [c], 'ok'), corpoDaRevisao(uuid, 'reject', [c], 'sem interesse')]) {
      const r = reviewInput.safeParse(corpo);
      assert.equal(r.success, true, JSON.stringify(r.error?.issues));
    }
  });
  test('rejeitar descarta as correções (o contrato só as aceita em approved_with_changes)', () => {
    const c = montarCorrecao({ path: 'a.value', valor: 'A' }, 'B')!;
    assert.deepEqual(corpoDaRevisao(uuid, 'reject', [c], 'não'), { subjectType: 'ai_analysis', subjectId: uuid, decision: 'rejected', corrections: [], comment: 'não' });
  });
});
