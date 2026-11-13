import { NextResponse } from 'next/server';
import { AppError, toPublicError } from '@/lib/errors';
import { config } from '@/lib/config';
import { parseCompraId, listarArquivos } from '@/lib/pncp/api';
import { escolherArquivoEdital } from '@/lib/pncp/compra';
import { startAnalysis } from '@/lib/service';
import { jobStreamResponse } from '@/lib/stream';
import { getJob } from '@/lib/store';
import { identidadeDaRequisicao } from '@/lib/limite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/pncp/analisar  { cnpj, ano, seq, arquivo? }
 * Baixa o edital publicado no PNCP e o envia ao mesmo pipeline de análise do
 * upload manual. Resposta: o mesmo stream SSE de progresso de /api/analyze.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { cnpj?: string; ano?: string; seq?: string; arquivo?: number }
      | null;
    const id = parseCompraId(String(body?.cnpj ?? ''), String(body?.ano ?? ''), String(body?.seq ?? ''));
    if (!id) throw new AppError('BAD_REQUEST', 'Identificação da compra inválida.', { status: 400 });

    const arquivos = await listarArquivos(id.cnpj, id.ano, id.sequencial);
    const arquivo =
      (typeof body?.arquivo === 'number' ? arquivos.find((item) => item.sequencial === body.arquivo) : null) ??
      escolherArquivoEdital(arquivos);
    if (!arquivo) {
      throw new AppError('PNCP_NO_PDF', 'O órgão não publicou arquivos para esta contratação no PNCP.', {
        status: 404,
        hint: 'Consulte o edital no sistema de origem indicado na página da oportunidade.',
      });
    }

    const buffer = await baixarPdf(arquivo.url);
    // O PNCP às vezes publica o título já com ".pdf" (ou repetido): normaliza para uma extensão só.
    const fileName = `${arquivo.titulo.trim().replace(/(\.pdf\s*)+$/i, '').trim() || 'edital'}.pdf`;
    const { job, reused } = await startAnalysis({
      buffer,
      fileName,
      fileSize: buffer.byteLength,
      quem: identidadeDaRequisicao(request),
    });

    const response = jobStreamResponse(getJob(job.id) ?? job);
    response.headers.set('X-Job-Id', job.id);
    response.headers.set('X-Job-Reused', reused ? '1' : '0');
    response.headers.set('X-File-Name', encodeURIComponent(fileName));
    return response;
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 500;
    return NextResponse.json({ error: toPublicError(error) }, { status: Number.isFinite(status) && status >= 400 ? status : 500 });
  }
}

async function baixarPdf(url: string): Promise<Buffer> {
  // Só baixamos do próprio PNCP: a URL vem da API, mas não confiamos cegamente.
  if (!/^https:\/\/pncp\.gov\.br\//.test(url)) {
    throw new AppError('BAD_REQUEST', 'Endereço de arquivo fora do PNCP.', { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow', cache: 'no-store' });
  } catch (error) {
    throw new AppError('PNCP_UNAVAILABLE', 'Não foi possível baixar o edital do PNCP.', {
      status: 503,
      hint: 'O portal oficial está instável. Tente novamente em alguns instantes.',
      cause: error,
    });
  }
  if (!response.ok) {
    throw new AppError('PNCP_UNAVAILABLE', `O PNCP recusou o download do edital (HTTP ${response.status}).`, { status: 502 });
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > config.upload.maxBytes) {
    throw new AppError('FILE_TOO_LARGE', `O edital publicado tem ${(declared / 1048576).toFixed(1)} MB e o limite é ${Math.round(config.upload.maxBytes / 1048576)} MB.`, {
      status: 413,
      hint: 'Baixe o arquivo pelo PNCP e envie apenas o edital (sem anexos) pelo Analisador.',
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > config.upload.maxBytes) {
    throw new AppError('FILE_TOO_LARGE', 'O edital publicado excede o tamanho máximo de análise.', { status: 413 });
  }

  const assinatura = buffer.subarray(0, 1024).toString('latin1');
  if (assinatura.startsWith('PK')) {
    throw new AppError('PNCP_NO_PDF', 'O órgão publicou o edital compactado (.zip), não em PDF.', {
      status: 415,
      hint: 'Baixe o arquivo pelo link do PNCP, extraia o PDF do edital e envie pelo Analisador.',
    });
  }
  if (!assinatura.includes('%PDF-')) {
    throw new AppError('PNCP_NO_PDF', 'O arquivo publicado no PNCP não é um PDF.', {
      status: 415,
      hint: 'Abra a contratação no PNCP e verifique o formato do edital publicado.',
    });
  }
  return buffer;
}
