import { coletarPrecos } from '@/lib/pncp/precos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/precos?q=notebook&ufs=SP,MG
 * Transmite em NDJSON (um evento JSON por linha) os preços vencedores
 * encontrados no PNCP, à medida que cada lote de licitações é lido.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const consulta = (params.get('q') ?? '').trim().slice(0, 120);
  const ufs = (params.get('ufs') ?? '')
    .split(',')
    .map((uf) => uf.trim().toUpperCase())
    .filter((uf) => /^[A-Z]{2}$/.test(uf));

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evento of coletarPrecos({ consulta, ufs }, abort.signal)) {
          if (abort.signal.aborted) break;
          controller.enqueue(encoder.encode(`${JSON.stringify(evento)}\n`));
        }
      } catch (error) {
        console.error('[precos] falha na coleta:', error);
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ tipo: 'erro', mensagem: 'A coleta de preços foi interrompida.', dica: 'Tente novamente.' })}\n`),
        );
      } finally {
        try {
          controller.close();
        } catch {
          /* cliente já desconectou */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
