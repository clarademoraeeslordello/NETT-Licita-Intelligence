import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/plataforma/app-shell';
import { WorkspaceProvider } from '@/components/plataforma/workspace-provider';
import { caminhoDeRetorno, COOKIE_EMPRESA, escolherEmpresa, urlDeLogin } from '@/components/sessao/empresa-atual';
import { SessaoProvider } from '@/components/sessao/sessao-provider';
import { getSession } from '@/server/auth';
import { listAccessibleCompanies } from '@/server/auth/session';
import { getDb } from '@/server/db';

/**
 * T-403 — shell autenticado. Sem sessão válida → login no Keycloak.
 * Empresas e papel vêm do servidor; o cliente recebe só o necessário para exibir.
 */
export default async function PlataformaLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    // `x-nett-pathname` é opcional (middleware, agente 01); sem ele o retorno é "/".
    const h = await headers();
    redirect(urlDeLogin(caminhoDeRetorno(h.get('x-nett-pathname'), h.get('x-nett-search'))));
  }

  const empresas = await listAccessibleCompanies(getDb(), session);
  const empresaAtual = escolherEmpresa(empresas, (await cookies()).get(COOKIE_EMPRESA)?.value);

  return (
    <SessaoProvider
      valor={{
        usuario: { nome: session.user.name, email: session.user.email },
        papeisGlobais: session.realmRoles,
        empresas,
        empresaAtual,
      }}
    >
      <WorkspaceProvider>
        <AppShell>{children}</AppShell>
      </WorkspaceProvider>
    </SessaoProvider>
  );
}
