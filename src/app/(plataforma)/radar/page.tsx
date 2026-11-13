import type { Metadata } from 'next';
import { RadarView } from '@/components/plataforma/radar-view';

export const metadata: Metadata = { title: 'Radar de editais' };

export default function RadarPage() {
  return <RadarView />;
}
