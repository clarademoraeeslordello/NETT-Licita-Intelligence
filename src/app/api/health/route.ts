import { NextResponse } from 'next/server';
import { collectCapabilities } from '@/lib/capabilities.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Informa quais capacidades estão disponíveis neste ambiente — se a IA está
 * configurada, se o gerador de PDF encontrou um navegador e quais são os
 * limites de upload/processamento.
 *
 * Nunca expõe a chave: apenas o booleano `configured`.
 */
export async function GET() {
  const capabilities = await collectCapabilities();
  return NextResponse.json(capabilities);
}
