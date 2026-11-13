// Amostras reais capturadas das APIs públicas em 13/11/2026 (tests/fixtures). Validam o mapeamento,
// não substituem os testes de integração, que consultam as APIs ao vivo.
import { describe, expect, it } from 'vitest';
import pncp from '../fixtures/pncp-atualizacao-amostra.json' with { type: 'json' };
import comprasgov from '../fixtures/comprasgov-contratacoes-amostra.json' with { type: 'json' };
import { normalizarCompraPncp, type CompraPncpRaw } from '../../src/conectores/pncp/conector.js';
import { normalizarContratacaoComprasGov, type ContratacaoComprasGovRaw } from '../../src/conectores/comprasgov/conector.js';
import { isoBrasilia, partesControlePncp } from '../../src/conectores/comum.js';
import { chaveCanonica } from '../../src/dedupe/dedupe.js';

describe('PNCP', () => {
  it('normaliza registros reais da consulta de atualização', () => {
    for (const raw of pncp.data as CompraPncpRaw[]) {
      const r = normalizarCompraPncp(raw)!;
      expect(r).not.toBeNull();
      expect(r.fonte).toBe('pncp');
      expect(r.idExterno).toBe(raw.numeroControlePNCP);
      expect(r.linkOficial).toMatch(/^https:\/\/pncp\.gov\.br\/app\/editais\/\d{14}\/\d{4}\/\d+$/);
      expect(r.orgaoCnpj).toMatch(/^\d{14}$/);
      expect(r.modalidadeIdPncp).toBe(6);
      expect(r.modalidadeNome).toBe('Pregão eletrônico');
      expect(r.objeto.length).toBeGreaterThan(5);
      expect(r.dataPublicacao).toMatch(/Z$/);
    }
  });

  it('descarta registro sem identificação', () => {
    expect(normalizarCompraPncp({ objetoCompra: 'x' })).toBeNull();
  });
});

describe('Compras.gov', () => {
  it('normaliza registros reais e converte modalidade para o código PNCP', () => {
    for (const raw of comprasgov.resultado as ContratacaoComprasGovRaw[]) {
      const r = normalizarContratacaoComprasGov(raw)!;
      expect(r.fonte).toBe('comprasgov');
      expect(r.idExterno).toBe(raw.idCompra);
      expect(r.numeroControlePncp).toBe(raw.numeroControlePNCP);
      expect(r.modalidadeIdPncp).toBe(8);
      expect(r.modalidadeNome).toBe('Dispensa');
    }
  });

  it('gera a mesma chave canônica que o PNCP para a mesma compra', () => {
    const raw = comprasgov.resultado[0] as ContratacaoComprasGovRaw;
    const cg = normalizarContratacaoComprasGov(raw)!;
    const p = partesControlePncp(raw.numeroControlePNCP!)!;
    const viaPncp = normalizarCompraPncp({
      numeroControlePNCP: raw.numeroControlePNCP!,
      anoCompra: Number(p.ano),
      sequencialCompra: Number(p.sequencial),
      orgaoEntidade: { cnpj: p.cnpj, razaoSocial: 'X' },
      objetoCompra: 'qualquer',
    })!;
    expect(chaveCanonica(cg)).toBe(chaveCanonica(viaPncp));
    expect(cg.linkOficial).toBe(viaPncp.linkOficial);
  });
});

describe('utilitários', () => {
  it('converte horário de Brasília para UTC', () => {
    expect(isoBrasilia('2026-11-10T08:00:01')).toBe('2026-11-10T11:00:01.000Z');
    expect(isoBrasilia('2026-11-10')).toBe('2026-11-10T03:00:00.000Z');
    expect(isoBrasilia(null)).toBeNull();
  });
  it('decompõe número de controle', () => {
    expect(partesControlePncp('00394502000144-1-014968/2026')).toEqual({ cnpj: '00394502000144', ano: '2026', sequencial: '14968' });
    expect(partesControlePncp('lixo')).toBeNull();
  });
});
