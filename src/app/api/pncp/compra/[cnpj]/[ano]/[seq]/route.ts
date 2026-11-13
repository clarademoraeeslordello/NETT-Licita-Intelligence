import { NextResponse } from 'next/server';
import { toPublicError } from '@/lib/errors';
import { carregarCompra } from '@/lib/pncp/compra';
import { parseCompraId } from '@/lib/pncp/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Context = { params: Promise<{ cnpj: string; ano: string; seq: string }> };

/** GET /api/pncp/compra/{cnpj}/{ano}/{sequencial} — detalhe, itens e arquivos. */
export async function GET(_request: Request, { params }: Context) {
  const { cnpj, ano, seq } = await params;
  const id = parseCompraId(cnpj, ano, seq);
  if (!id) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Identificação da compra inválida.' } }, { status: 400 });
  }
  try {
    return NextResponse.json(await carregarCompra(id.cnpj, id.ano, id.sequencial));
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 500;
    return NextResponse.json({ error: toPublicError(error) }, { status: Number.isFinite(status) ? status : 500 });
  }
}
