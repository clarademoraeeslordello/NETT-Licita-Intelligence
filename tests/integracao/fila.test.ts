import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { concluir, enfileirar, falhar, recuperarExpirados, reservar } from '../../src/fila/fila.js';
import { fecharPool, obterPool, prepararBanco } from './preparar.js';

beforeAll(prepararBanco);
afterAll(fecharPool);

describe('fila persistente (PostgreSQL real)', () => {
  it('não duplica jobs abertos com a mesma chave', async () => {
    const a = await enfileirar({ tipo: 't.dedupe', chaveDedupe: 'k1' });
    const b = await enfileirar({ tipo: 't.dedupe', chaveDedupe: 'k1' });
    expect(a).toBeTypeOf('number');
    expect(b).toBeNull();
    const [job] = await reservar({ tipos: ['t.dedupe'] });
    await concluir(job!.id);
    expect(await enfileirar({ tipo: 't.dedupe', chaveDedupe: 'k1' })).toBeTypeOf('number');
  });

  it('reagenda com backoff e marca como morto ao esgotar tentativas', async () => {
    await enfileirar({ tipo: 't.falha', maxTentativas: 2 });
    let [job] = await reservar({ tipos: ['t.falha'] });
    expect(await falhar(job!, new Error('x'))).toBe('reagendado');
    expect(await reservar({ tipos: ['t.falha'] })).toHaveLength(0); // aguardando backoff
    await obterPool().query(`UPDATE integracao.fila_job SET disponivel_em = now() WHERE tipo = 't.falha'`);
    [job] = await reservar({ tipos: ['t.falha'] });
    expect(job!.tentativas).toBe(2);
    expect(await falhar(job!, new Error('y'))).toBe('morto');
    const { rows } = await obterPool().query(`SELECT status, ultimo_erro FROM integracao.fila_job WHERE tipo = 't.falha'`);
    expect(rows[0]).toMatchObject({ status: 'morto', ultimo_erro: 'y' });
  });

  it('respeita orçamento por hora sem descartar o excedente', async () => {
    for (let i = 0; i < 5; i += 1) await enfileirar({ tipo: 't.orcado', chaveDedupe: `o${i}` });
    const lote1 = await reservar({ tipos: ['t.orcado'], limite: 10, orcamentos: { 't.orcado': 3 } });
    expect(lote1).toHaveLength(3);
    for (const j of lote1) await concluir(j.id);
    expect(await reservar({ tipos: ['t.orcado'], limite: 10, orcamentos: { 't.orcado': 3 } })).toHaveLength(0);
    const { rows } = await obterPool().query(`SELECT count(*)::int AS n FROM integracao.fila_job WHERE tipo = 't.orcado' AND status = 'pendente'`);
    expect(rows[0].n).toBe(2);
    // Uma hora depois o orçamento se renova.
    await obterPool().query(`UPDATE integracao.fila_job SET concluido_em = now() - interval '61 minutes' WHERE tipo = 't.orcado' AND status = 'concluido'`);
    expect(await reservar({ tipos: ['t.orcado'], limite: 10, orcamentos: { 't.orcado': 3 } })).toHaveLength(2);
  });

  it('devolve à fila jobs de worker interrompido', async () => {
    await enfileirar({ tipo: 't.lease' });
    await reservar({ tipos: ['t.lease'], leaseMs: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(await recuperarExpirados()).toBeGreaterThanOrEqual(1);
    expect(await reservar({ tipos: ['t.lease'] })).toHaveLength(1);
  });

  it('reserva concorrente não entrega o mesmo job duas vezes', async () => {
    for (let i = 0; i < 20; i += 1) await enfileirar({ tipo: 't.conc' });
    const lotes = await Promise.all(Array.from({ length: 5 }, () => reservar({ tipos: ['t.conc'], limite: 10 })));
    const ids = lotes.flat().map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(20);
  });
});

describe('agendamento horário', () => {
  it('cria uma coleta por fonte por janela, mesmo após a conclusão', async () => {
    const { agendar } = await import('../../src/agendador.js');
    const { carregarConfig } = await import('../../src/config/index.js');
    const config = carregarConfig({ DATABASE_URL: 'x', FONTES_ATIVAS: 'pncp,comprasgov' });
    const agora = new Date('2026-11-13T10:10:00Z');
    expect(await agendar(config, agora)).toHaveLength(2);
    const jobs = await reservar({ tipos: ['coleta.listar'], limite: 10 });
    for (const j of jobs) await concluir(j.id);
    expect(await agendar(config, new Date('2026-11-13T10:50:00Z'))).toHaveLength(0);
    expect(await agendar(config, new Date('2026-11-13T11:00:00Z'))).toHaveLength(2);
  });
});
