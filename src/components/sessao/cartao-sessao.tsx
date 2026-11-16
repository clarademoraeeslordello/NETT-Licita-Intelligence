'use client';

import { usePathname } from 'next/navigation';
import { selecionarEmpresa } from '@/app/(plataforma)/acoes-sessao';
import { ordenarEmpresas, ROTULO_PAPEL } from './empresa-atual';
import { useSessao } from './sessao-provider';

/** Rodapé da barra lateral: usuário, seletor de empresa e saída. */
export function CartaoSessao() {
  const { usuario, papeisGlobais, empresas, empresaAtual } = useSessao();
  const pathname = usePathname();
  const inicial = (usuario.nome || usuario.email).slice(0, 1).toUpperCase();

  return (
    <div className="space-y-3 rounded-2xl border border-nett-text/10 bg-nett-text/5 p-3" data-testid="cartao-sessao">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-nett-gold/20 text-sm font-semibold text-nett-gold-light">
          {inicial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-nett-text">{usuario.nome || usuario.email}</p>
          <p className="truncate text-xs text-nett-text-muted">
            {papeisGlobais.includes('nett_admin') ? 'Administrador Nett' : papeisGlobais.includes('nett_consultant') ? 'Consultor Nett' : usuario.email}
          </p>
        </div>
      </div>

      {empresas.length === 0 ? (
        <p role="status" className="rounded-xl border border-nett-gold-dark px-3 py-2 text-xs leading-relaxed text-nett-text-muted">
          Nenhuma empresa vinculada ao seu usuário. Peça acesso a um administrador Nett.
        </p>
      ) : (
        <form action={selecionarEmpresa} className="space-y-2">
          <input type="hidden" name="voltarPara" value={pathname} />
          <label htmlFor="seletor-empresa" className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-nett-text-muted">
            Empresa
          </label>
          <div className="flex gap-2">
            <select
              id="seletor-empresa"
              name="companyId"
              defaultValue={empresaAtual?.id}
              key={empresaAtual?.id}
              className="h-9 min-w-0 flex-1 rounded-lg border border-nett-text-muted/15 bg-nett-raised px-2 text-sm text-nett-text focus:border-nett-gold focus:outline-none"
            >
              {ordenarEmpresas(empresas).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.legalName}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-9 shrink-0 rounded-lg bg-nett-gold px-3 text-xs font-semibold text-nett-black transition hover:bg-nett-gold-light"
            >
              Trocar
            </button>
          </div>
          {empresaAtual ? <p className="text-[11px] text-nett-text-muted">Seu papel: {ROTULO_PAPEL[empresaAtual.role]}</p> : null}
        </form>
      )}

      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="w-full rounded-lg border border-nett-text-muted/15 px-3 py-2 text-xs font-medium text-nett-text-muted transition hover:border-nett-gold hover:text-nett-text"
        >
          Sair
        </button>
      </form>
    </div>
  );
}
