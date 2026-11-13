import { describe, expect, it } from 'vitest';
import { Dicionario } from '../../src/dicionario/dicionario.js';
import { chaveCanonica, similaridadeObjeto } from '../../src/dedupe/dedupe.js';
import { janelaAtual } from '../../src/agendador.js';
import { diasDaJanela } from '../../src/conectores/tipos.js';

const dic = new Dicionario({
  versao: 't',
  oficial: false,
  termos: [
    { termo: 'software', sinonimos: ['sistema de gestão'] },
    { termo: 'rede de dados', sinonimos: [] },
  ],
  exclusoes: ['jogo de software'],
});

describe('dicionário comercial', () => {
  it('encontra termos ignorando acentos, caixa e pontuação', () => {
    expect(dic.avaliar('Contratação de SISTEMA DE GESTÃO pública')).toEqual(['software']);
    expect(dic.avaliar('Licença de Software; e REDE-DE-DADOS')).toEqual(['software', 'rede de dados']);
  });
  it('respeita limite de palavra e exclusões', () => {
    expect(dic.avaliar('softwares')).toEqual([]);
    expect(dic.avaliar('aquisição de jogo de software')).toEqual([]);
    expect(dic.avaliar(null, 'complemento com software')).toEqual(['software']);
  });
});

describe('deduplicação', () => {
  it('prioriza número de controle, depois processo, depois fonte+id', () => {
    const base = { fonte: 'pncp' as const, idExterno: 'x', orgaoCnpj: '1', processo: '23.001/2026-1', ano: 2026 };
    expect(chaveCanonica({ ...base, numeroControlePncp: 'A-1-000001/2026' })).toBe('pncp:A-1-000001/2026');
    expect(chaveCanonica({ ...base, numeroControlePncp: null })).toBe('proc:1:2300120261:2026');
    expect(chaveCanonica({ ...base, numeroControlePncp: null, processo: null })).toBe('fonte:pncp:x');
  });
  it('mede similaridade de objetos', () => {
    expect(similaridadeObjeto('Aquisição de computadores para a secretaria', 'AQUISIÇÃO DE COMPUTADORES PARA SECRETARIA')).toBe(1);
    expect(similaridadeObjeto('Aquisição de computadores', 'Serviço de limpeza')).toBe(0);
  });
});

describe('agendamento e janela', () => {
  it('agrupa no mesmo bloco horário', () => {
    expect(janelaAtual(new Date('2026-11-13T10:05:00Z'), 60)).toBe(janelaAtual(new Date('2026-11-13T10:59:59Z'), 60));
    expect(janelaAtual(new Date('2026-11-13T10:59:59Z'), 60)).not.toBe(janelaAtual(new Date('2026-11-13T11:00:00Z'), 60));
  });
  it('usa dias no fuso de Brasília', () => {
    expect(diasDaJanela(new Date('2026-11-13T02:00:00Z'), 1)).toEqual([
      { dia: '2026-11-12', fechado: false },
      { dia: '2026-11-11', fechado: true },
    ]);
  });
});
