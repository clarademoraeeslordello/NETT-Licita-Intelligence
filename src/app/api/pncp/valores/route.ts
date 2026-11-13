import { NextResponse } from 'next/server';
import { listarItens } from '@/lib/pncp/api';
import { mapLimit } from '@/lib/pncp/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_IDS = 8;

/**
 * GET /api/pncp/valores?ids=cnpj-ano-seq,...
 *
 * Valor estimado de cada contratação, somado a partir dos itens. O endpoint de
 * detalhe da compra (/consulta) aplica limite de requisições agressivo (HTTP
 * 429) e bloqueia o IP por minutos; o de itens não. A soma dos itens é o mesmo
 * número que o PNCP exibe como "valor total estimado".
 */
export async function GET(request: Request) {
  const ids = [
    ...new Set(
      (new URL(request.url).searchParams.get('ids') ?? '')
        .split(',')
        .filter((id) => /^\d{14}-\d{4}-\d{1,7}$/.test(id)),
    ),
  ].slice(0, MAX_IDS);

  // Orçamento de tempo: o PNCP às vezes segura conexões vindas de nuvem. Cada compra
  // tem 8 s (só a 1ª página de itens, que cobre quase todas) e o lote inteiro, 25 s.
  const expirou = new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error('orçamento esgotado')), 25_000));
  const resultados = await mapLimit(ids, 3, (id) => {
    const [cnpj, ano, sequencial] = id.split('-');
    const consulta = listarItens(cnpj, ano, sequencial, { paginas: 1, timeoutMs: 8_000 }).then((itens) => {
      const comValor = itens.filter((item) => item.valorTotalEstimado !== null);
      // Todos os itens sigilosos (ou sem itens publicados): valor desconhecido, não zero.
      return comValor.length ? Math.round(comValor.reduce((total, item) => total + (item.valorTotalEstimado ?? 0), 0) * 100) / 100 : null;
    });
    return Promise.race([consulta, expirou]);
  });

  const valores: Record<string, number | null> = {};
  const falhas: string[] = [];
  resultados.forEach((resultado, indice) => {
    if (resultado.status === 'fulfilled') valores[ids[indice]] = resultado.value;
    else falhas.push(ids[indice]);
  });

  return NextResponse.json({ valores, falhas });
}
