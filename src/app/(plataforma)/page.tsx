import type { Metadata } from 'next';
import { PainelView } from '@/components/plataforma/painel-view';

export const metadata: Metadata = { title: 'Painel' };

export default function PainelPage() {
  return <PainelView />;
}
