import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OportunidadeView } from '@/components/plataforma/oportunidade-view';
import { parseCompraId } from '@/lib/pncp/api';

export const metadata: Metadata = { title: 'Oportunidade' };

type PageProps = { params: Promise<{ cnpj: string; ano: string; seq: string }> };

export default async function OportunidadePage({ params }: PageProps) {
  const { cnpj, ano, seq } = await params;
  const id = parseCompraId(cnpj, ano, seq);
  if (!id) notFound();
  return <OportunidadeView cnpj={id.cnpj} ano={id.ano} seq={id.sequencial} />;
}
