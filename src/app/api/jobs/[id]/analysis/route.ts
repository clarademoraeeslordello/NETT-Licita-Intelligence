import { NextResponse } from 'next/server';
import { obterAnalise } from '@/lib/persistencia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/jobs/:id/analysis — análise completa validada pelo schema. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const found = await obterAnalise(id);

  if (!found) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Análise ainda não disponível ou expirada no servidor.',
        },
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    job: {
      id: found.job.id,
      fileName: found.job.fileName,
      fileSize: found.job.fileSize,
      isDemo: found.job.isDemo,
      createdAt: found.job.createdAt,
    },
    analise: found.analise,
    meta: found.job.result?.meta,
  });
}
