'use server';

/**
 * T-403 — troca da empresa ativa. Server Action (POST da própria origem; o Next
 * valida Origin/Host). Autorização: requireCompanyAccess, que também registra a
 * negação na auditoria. O cookie guarda só o id; nada de negócio no navegador.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { readAuthConfig } from '@/server/auth/config';
import { AuthError, requireCompanyAccess, requireSession } from '@/server/auth';
import { COOKIE_EMPRESA, COOKIE_EMPRESA_MAX_AGE_S, caminhoDeRetorno } from '@/components/sessao/empresa-atual';

const entrada = z.object({ companyId: z.uuid(), voltarPara: z.string().max(2048).optional() });

export async function selecionarEmpresa(formData: FormData): Promise<void> {
  const dados = entrada.safeParse({ companyId: formData.get('companyId'), voltarPara: formData.get('voltarPara') ?? undefined });
  const voltar = caminhoDeRetorno(dados.success ? dados.data.voltarPara : null, null);
  if (!dados.success) redirect(voltar);

  let session;
  try {
    session = await requireSession();
  } catch (e) {
    if (e instanceof AuthError) redirect(`/api/auth/login?returnTo=${encodeURIComponent(voltar)}`);
    throw e;
  }
  try {
    await requireCompanyAccess(session, dados.data.companyId, 'viewer');
  } catch (e) {
    // Sem acesso: mantém a empresa atual. A negação já foi auditada pelo guard.
    if (e instanceof AuthError) redirect(voltar);
    throw e;
  }

  (await cookies()).set(COOKIE_EMPRESA, dados.data.companyId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: readAuthConfig().secureCookies,
    path: '/',
    maxAge: COOKIE_EMPRESA_MAX_AGE_S,
  });
  redirect(voltar);
}
