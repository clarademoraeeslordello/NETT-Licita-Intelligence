import { NextResponse } from 'next/server';
import { AppError, toPublicError } from '@/lib/errors';
import { config } from '@/lib/config';
import { startAnalysis, validateUpload } from '@/lib/service';
import { jobStreamResponse } from '@/lib/stream';
import { getJob } from '@/lib/store';
import { identidadeDaRequisicao } from '@/lib/limite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Tolerância para o envelope multipart (boundaries, cabeçalhos, campos). */
const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

/**
 * POST /api/analyze
 * Recebe o PDF (multipart/form-data, campo `file`) e devolve um stream SSE com
 * o progresso das etapas.
 */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Envie o arquivo como multipart/form-data no campo "file".',
          },
        },
        { status: 400 },
      );
    }

    // Barreira antecipada: recusa pelo Content-Length antes de materializar o
    // corpo na memória. Sem isso, um upload gigante seria bufferizado por
    // inteiro (duas vezes) antes da validação de tamanho.
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > config.upload.maxBytes + MULTIPART_OVERHEAD_BYTES) {
      throw new AppError(
        'FILE_TOO_LARGE',
        `O envio tem ${(declaredLength / (1024 * 1024)).toFixed(1)} MB e o limite é ${Math.round(config.upload.maxBytes / (1024 * 1024))} MB.`,
        {
          status: 413,
          hint: 'Reduza o PDF (remova imagens digitalizadas) ou aumente MAX_UPLOAD_MB no .env.',
        },
      );
    }

    // Corpo multipart que o parser não consegue ler (envio truncado, boundary
    // errado) é requisição inválida — não erro interno do servidor.
    const formData = await request.formData().catch(() => {
      throw new AppError('BAD_REQUEST', 'Não foi possível ler o envio do arquivo.', {
        status: 400,
        hint: 'Envie o PDF como multipart/form-data no campo "file" e garanta que o upload foi concluído.',
      });
    });
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Nenhum arquivo foi enviado no campo "file".' } },
        { status: 400 },
      );
    }

    // Segunda barreira: o tamanho real do arquivo, antes de ler o conteúdo.
    if (file.size > config.upload.maxBytes) {
      throw new AppError(
        'FILE_TOO_LARGE',
        `O arquivo tem ${(file.size / (1024 * 1024)).toFixed(1)} MB e o limite é ${Math.round(config.upload.maxBytes / (1024 * 1024))} MB.`,
        { status: 413, hint: 'Reduza o PDF ou aumente MAX_UPLOAD_MB no .env.' },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    validateUpload(file, buffer);

    const { job, reused } = await startAnalysis({
      buffer,
      fileName: file.name,
      fileSize: buffer.byteLength,
      quem: identidadeDaRequisicao(request),
    });

    const streamable = getJob(job.id) ?? job;
    const response = jobStreamResponse(streamable);
    response.headers.set('X-Job-Id', job.id);
    response.headers.set('X-Job-Reused', reused ? '1' : '0');
    return response;
  } catch (error) {
    const publicError = toPublicError(error);
    const status =
      typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 500;
    return NextResponse.json(
      { error: publicError, job: null },
      { status: Number.isFinite(status) ? status : 500 },
    );
  }
}

/** GET /api/analyze — utilidade de diagnóstico (não recebe arquivo). */
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Use POST multipart/form-data com o campo "file" para analisar um edital.',
    limits: {
      maxUploadMb: Math.round(config.upload.maxBytes / (1024 * 1024)),
      maxPages: config.upload.maxPages,
    },
  });
}
