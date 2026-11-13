import type { Metadata } from 'next';
import { PipelineView } from '@/components/plataforma/pipeline-view';

export const metadata: Metadata = { title: 'Pipeline' };

export default function PipelinePage() {
  return <PipelineView />;
}
