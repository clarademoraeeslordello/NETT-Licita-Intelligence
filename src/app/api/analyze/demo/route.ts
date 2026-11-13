import { NextResponse } from 'next/server';
import { getDemoPdf } from '@/lib/demo';
import { toPublicError } from '@/lib/errors';
import { startAnalysis } from '@/lib/service';
import { jobStreamResponse } from '@/lib/stream';
import { getJob } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/analyze/demo
 * Analisa o edital de demonstração em um clique, pelo mesmo pipeline do upload.
 * Usa o PDF gerado pelo próprio projeto — nada de dados simulados no frontend.
 */
export async function POST() {
  try {
    const { buffer, fileName } = getDemoPdf();
    const { job, reused } = await startAnalysis({
      buffer,
      fileName,
      fileSize: buffer.byteLength,
      isDemo: true,
    });

    const streamable = getJob(job.id) ?? job;
    const response = jobStreamResponse(streamable);
    response.headers.set('X-Job-Id', job.id);
    response.headers.set('X-Demo', '1');
    // Mesmo contrato do upload: a interface precisa saber que o resultado veio do
    // cache para reencenar a conclusão em vez de esperar um processamento novo.
    response.headers.set('X-Job-Reused', reused ? '1' : '0');
    return response;
  } catch (error) {
    const publicError = toPublicError(error);
    const status =
      typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 500;
    return NextResponse.json(
      { error: publicError },
      { status: Number.isFinite(status) && status >= 400 ? status : 500 },
    );
  }
}
