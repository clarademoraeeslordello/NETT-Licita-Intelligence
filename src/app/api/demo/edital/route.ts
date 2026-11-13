import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { getDemoPdf } from '@/lib/demo';

export const runtime = 'nodejs';

/**
 * GET /api/demo/edital?download=1
 * Entrega o PDF fictício usado na demonstração — o mesmo arquivo que o botão
 * "Analisar edital de demonstração" envia para o pipeline.
 */
export async function GET(request: Request) {
  const { buffer, fileName } = getDemoPdf();
  const download = new URL(request.url).searchParams.get('download') === '1';
  const asciiName = 'edital-demo.pdf';

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.byteLength),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'public, max-age=3600',
      // Valores de cabeçalho HTTP só aceitam um byte por caractere: um travessão
      // (U+2014) aqui derruba a resposta com 500 antes mesmo de sair do servidor.
      'X-Document-Notice': 'DOCUMENTO FICTÍCIO - gerado para demonstração do ' + config.app.name,
    },
  });
}
