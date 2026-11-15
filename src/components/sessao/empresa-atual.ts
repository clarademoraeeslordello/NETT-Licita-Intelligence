/**
 * Seleção da empresa (tenant) ativa no shell — lógica pura, sem I/O.
 * O cookie guarda só o id escolhido; a autorização vem sempre da lista de
 * empresas acessíveis da sessão (listAccessibleCompanies) e, na escrita, de
 * requireCompanyAccess. Um id forjado no cookie é simplesmente ignorado.
 */
import type { CompanyRole } from '@/server/auth';

export const COOKIE_EMPRESA = 'nett_empresa';
export const COOKIE_EMPRESA_MAX_AGE_S = 30 * 24 * 60 * 60;

export type EmpresaAcessivel = { id: string; legalName: string; role: CompanyRole };

/** Empresa ativa: a do cookie, se acessível; senão a primeira em ordem alfabética; senão null. */
export function escolherEmpresa(empresas: readonly EmpresaAcessivel[], idCookie: string | undefined | null): EmpresaAcessivel | null {
  if (empresas.length === 0) return null;
  const doCookie = idCookie ? empresas.find((e) => e.id === idCookie) : undefined;
  return doCookie ?? ordenarEmpresas(empresas)[0];
}

export function ordenarEmpresas(empresas: readonly EmpresaAcessivel[]): EmpresaAcessivel[] {
  return [...empresas].sort((a, b) => a.legalName.localeCompare(b.legalName, 'pt-BR'));
}

export const ROTULO_PAPEL: Record<CompanyRole, string> = {
  company_admin: 'Administrador',
  consultant: 'Consultor',
  viewer: 'Leitura',
};

/** Caminho de retorno do login a partir do cabeçalho de caminho (se o middleware o fornecer). */
export function caminhoDeRetorno(pathname: string | null | undefined, search: string | null | undefined): string {
  if (!pathname || !pathname.startsWith('/') || pathname.startsWith('//')) return '/';
  return `${pathname}${search && search.startsWith('?') ? search : ''}`;
}

export function urlDeLogin(retorno: string): string {
  return `/api/auth/login?returnTo=${encodeURIComponent(retorno)}`;
}
