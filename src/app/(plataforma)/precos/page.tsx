import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PrecosView } from '@/components/plataforma/precos-view';

export const metadata: Metadata = { title: 'Preços vencedores' };

export default function PrecosPage() {
  return (
    <Suspense>
      <PrecosView />
    </Suspense>
  );
}
