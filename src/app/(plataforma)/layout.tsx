import { AppShell } from '@/components/plataforma/app-shell';
import { WorkspaceProvider } from '@/components/plataforma/workspace-provider';

export default function PlataformaLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
