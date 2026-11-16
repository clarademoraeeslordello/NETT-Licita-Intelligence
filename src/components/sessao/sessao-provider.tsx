'use client';

import { createContext, useContext } from 'react';
import type { EmpresaAcessivel } from './empresa-atual';

export type SessaoCliente = {
  usuario: { nome: string; email: string };
  papeisGlobais: Array<'nett_admin' | 'nett_consultant'>;
  empresas: EmpresaAcessivel[];
  empresaAtual: EmpresaAcessivel | null;
};

const Contexto = createContext<SessaoCliente | null>(null);

/** Dados da sessão já autorizados no servidor (layout). Sem tokens nem segredos. */
export function SessaoProvider({ valor, children }: { valor: SessaoCliente; children: React.ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): SessaoCliente {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useSessao fora do SessaoProvider');
  return valor;
}
