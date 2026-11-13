import { NextResponse } from 'next/server';
import { toPublicError } from '@/lib/errors';
import { executarRadar, sanitizarRadarInput } from '@/lib/pncp/radar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const lista = (value: string | null) => (value ?? '').split(',').filter(Boolean);

/**
 * GET /api/radar?termos=notebook,monitor&ufs=SP,MG&modalidades=6,8
 * Oportunidades abertas no PNCP para os termos do perfil.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const input = sanitizarRadarInput({
      termos: lista(params.get('termos')),
      ufs: lista(params.get('ufs')),
      modalidades: lista(params.get('modalidades')).map(Number),
    });
    return NextResponse.json(await executarRadar(input));
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 500;
    return NextResponse.json({ error: toPublicError(error) }, { status: Number.isFinite(status) ? status : 500 });
  }
}
