import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IconSparkles } from '@/components/icons';
import { RevisaoView } from '@/components/plataforma/revisao-view';
import { PageHeader, Vazio } from '@/components/plataforma/ui';
import { caminhoDeRetorno, COOKIE_EMPRESA, escolherEmpresa, urlDeLogin } from '@/components/sessao/empresa-atual';
import { uuid } from '@/contracts';
import { getSession } from '@/server/auth';
import { listAccessibleCompanies } from '@/server/auth/session';
import { getDb } from '@/server/db';
import { carregarRevisao } from './dados';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Revisão da análise' };

/** T-405 — revisão humana de uma análise de IA. A empresa é a ativa da sessão; análise de outra empresa = 404. */
export default async function RevisaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const session = await getSession();
  if (!session) {
    const h = await headers();
    redirect(urlDeLogin(caminhoDeRetorno(h.get('x-nett-pathname') ?? `/revisao/${id}`, h.get('x-nett-search'))));
  }
  const db = getDb();
  const empresas = await listAccessibleCompanies(db, session);
  const empresa = escolherEmpresa(empresas, (await cookies()).get(COOKIE_EMPRESA)?.value);
  if (!empresa) {
    return (
      <>
        <PageHeader eyebrow="Revisão humana" titulo="Revisão da análise" />
        <Vazio icone={<IconSparkles size={24} />} titulo="Nenhuma empresa selecionada">
          Peça a um administrador para vincular você a uma empresa cliente.
        </Vazio>
      </>
    );
  }

  const dados = await carregarRevisao(db, empresa.id, id);
  if (!dados) notFound();
  return <RevisaoView dados={dados} podeEscrever={empresa.role !== 'viewer'} />;
}
