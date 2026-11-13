import type { Metadata } from 'next';
import { PerfilView } from '@/components/plataforma/perfil-view';

export const metadata: Metadata = { title: 'Perfil e filtros' };

export default function PerfilPage() {
  return <PerfilView />;
}
