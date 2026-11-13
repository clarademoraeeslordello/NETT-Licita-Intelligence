import { NextResponse } from 'next/server';
import { toPublicError } from '@/lib/errors';
import { browserStatus, htmlToPdf } from '@/lib/report/browser';
import { renderReportHtml, reportFileName } from '@/lib/report/document';
import { obterAnalise } from '@/lib/persistencia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/** GET /api/jobs/:id/report.pdf — relatório profissional em PDF (A4). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const found = await obterAnalise(id);

  if (!found) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Análise não encontrada ou expirada.' } },
      { status: 404 },
    );
  }

  const status = await browserStatus();
  if (!status.available) {
    return NextResponse.json(
      {
        error: {
          code: 'REPORT_BROWSER_MISSING',
          message: 'O gerador de PDF não está disponível neste servidor.',
          hint: status.reason,
        },
      },
      { status: 503 },
    );
  }

  try {
    const html = renderReportHtml(found.analise, found.job.result?.meta ?? {
      engine: 'local-demo',
      avisos: [],
    });
    const pdf = await htmlToPdf(html);

    const contentType = found.job.isDemo ? 'demonstracao' : 'upload';
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': `attachment; filename="analise-edital.pdf"; filename*=UTF-8''${encodeURIComponent(reportFileName(found.analise))}`,
        'Cache-Control': 'no-store',
        'X-Report-Source': contentType,
      },
    });
  } catch (error) {
    const publicError = toPublicError(error);
    const status404 = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 500;
    return NextResponse.json({ error: publicError }, { status: Number.isFinite(status404) ? status404 : 500 });
  }
}
