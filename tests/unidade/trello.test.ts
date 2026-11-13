import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinaturaValida } from '../../src/conectores/trello/webhook.js';
import { controlesPncpNoCard, resumoAcao } from '../../src/conectores/trello/sincronizacao.js';
import { ocultarSegredos } from '../../src/observabilidade/log.js';

describe('webhook Trello', () => {
  const corpo = '{"action":{"id":"1"}}';
  const url = 'https://exemplo.test/webhooks/trello';
  const assinatura = createHmac('sha1', 'segredo').update(corpo + url).digest('base64');
  it('aceita assinatura correta e rejeita alterada', () => {
    expect(assinaturaValida(corpo, url, 'segredo', assinatura)).toBe(true);
    expect(assinaturaValida(corpo + ' ', url, 'segredo', assinatura)).toBe(false);
    expect(assinaturaValida(corpo, url, '', assinatura)).toBe(false);
    expect(assinaturaValida(corpo, url, 'segredo', undefined)).toBe(false);
  });
});

describe('vínculo card ↔ PNCP', () => {
  it('extrai número de controle do texto e de links', () => {
    expect(
      controlesPncpNoCard({
        name: 'Pregão 12/2026',
        desc: 'ver 00394502000144-1-014968/2026',
        attachments: [{ id: 'a', name: 'edital', url: 'https://pncp.gov.br/app/editais/75924290000169/2026/36', mimeType: null, bytes: null, date: null }],
      }).sort(),
    ).toEqual(['00394502000144-1-014968/2026', '75924290000169-1-000036/2026']);
  });
  it('resume movimentação entre listas', () => {
    expect(
      resumoAcao({ id: 'x', type: 'updateCard', date: '2026-11-13T00:00:00Z', data: { card: { id: 'c' }, listBefore: { id: 'l1' }, listAfter: { id: 'l2' } } }),
    ).toEqual({ cardId: 'c', texto: null, listaOrigem: 'l1', listaDestino: 'l2' });
  });
});

describe('logs', () => {
  it('oculta key/token em URLs', () => {
    expect(ocultarSegredos('https://api.trello.com/1/x?key=abc&token=def&y=1')).toBe('https://api.trello.com/1/x?key=***&token=***&y=1');
  });
});
