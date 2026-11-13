import { NextResponse } from 'next/server';
import { hasAIProvider } from '@/lib/config';
import { consultarCota, identidadeDaRequisicao } from '@/lib/limite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/cota — quantas análises com IA quem pede ainda tem na janela atual. */
export async function GET(request: Request) {
  if (!hasAIProvider()) return NextResponse.json({ ia: false });
  const cota = await consultarCota(identidadeDaRequisicao(request));
  return NextResponse.json({ ia: true, ...cota }, { headers: { 'Cache-Control': 'no-store' } });
}
