'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  IconCalendar,
  IconChart,
  IconFolder,
  IconHome,
  IconKanban,
  IconMenu,
  IconRadar,
  IconSparkles,
  IconUser,
  IconX,
} from '@/components/icons';
import { ETAPAS_ATIVAS, situacaoDocumento } from '@/lib/plataforma/workspace';
import { useWorkspace } from './workspace-provider';

type ItemNav = {
  href: string;
  label: string;
  icon: (props: { size?: number }) => React.ReactElement;
  badge?: 'pipeline' | 'documentos';
};

const GRUPOS: Array<{ titulo: string; itens: ItemNav[] }> = [
  {
    titulo: 'Operação',
    itens: [
      { href: '/', label: 'Painel', icon: IconHome },
      { href: '/radar', label: 'Radar de editais', icon: IconRadar },
      { href: '/pipeline', label: 'Pipeline', icon: IconKanban, badge: 'pipeline' },
      { href: '/agenda', label: 'Agenda', icon: IconCalendar },
    ],
  },
  {
    titulo: 'Inteligência',
    itens: [
      { href: '/precos', label: 'Preços vencedores', icon: IconChart },
      { href: '/analisador', label: 'Analisador de edital', icon: IconSparkles },
    ],
  },
  {
    titulo: 'Empresa',
    itens: [
      { href: '/documentos', label: 'Documentos', icon: IconFolder, badge: 'documentos' },
      { href: '/perfil', label: 'Perfil e filtros', icon: IconUser },
    ],
  },
];

function ativo(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Marca({ compacta = false }: { compacta?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="relative flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-nett-gold-light to-nett-gold-light text-nett-text shadow-soft">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 19 12 5l7 14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.5 13.5h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
      {compacta ? null : (
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-tight text-nett-text">LicitaFlow</span>
          <span className="block text-[11px] text-nett-text-muted">Inteligência em licitações</span>
        </span>
      )}
    </Link>
  );
}

function Navegacao({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { ws, pronto } = useWorkspace();

  const contagem = {
    pipeline: ws.pipeline.filter((card) => ETAPAS_ATIVAS.includes(card.etapa)).length,
    documentos: ws.documentos.filter((doc) => situacaoDocumento(doc).situacao === 'vencido' || situacaoDocumento(doc).situacao === 'a-vencer').length,
  };

  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-6">
      {GRUPOS.map((grupo) => (
        <div key={grupo.titulo}>
          <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-nett-text-muted">{grupo.titulo}</p>
          <ul className="mt-2 space-y-0.5">
            {grupo.itens.map((item) => {
              const selecionado = ativo(pathname, item.href);
              const badge = item.badge && pronto ? contagem[item.badge] : 0;
              const Icone = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={selecionado ? 'page' : undefined}
                    className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                      selecionado ? 'bg-nett-text/10 font-medium text-nett-text' : 'text-nett-text-muted hover:bg-nett-text/5 hover:text-nett-text'
                    }`}
                  >
                    <span className={selecionado ? 'text-nett-gold-light' : 'text-nett-text-muted group-hover:text-nett-text'}>
                      <Icone size={18} />
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {badge ? (
                      <span
                        className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold ${
                          item.badge === 'documentos' ? 'bg-nett-text text-nett-black' : 'bg-nett-text/10 text-nett-text'
                        }`}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function CartaoEmpresa() {
  const { ws, pronto } = useWorkspace();
  return (
    <div className="rounded-2xl border border-nett-text/10 bg-nett-text/5 p-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-nett-gold/20 text-sm font-semibold text-nett-gold-light">
          {pronto ? ws.perfil.empresa.slice(0, 1).toUpperCase() : '·'}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-nett-text">{pronto ? ws.perfil.empresa : 'Carregando…'}</p>
          <p className="text-xs text-nett-text-muted">{pronto ? `Porte ${ws.perfil.porte} · ${ws.perfil.ufs.length || 'todas as'} UF` : ' '}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-nett-text-muted">
        Modo demonstração: seus dados ficam salvos só neste navegador.
      </p>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMenuAberto(false), [pathname]);

  useEffect(() => {
    if (!menuAberto) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMenuAberto(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [menuAberto]);

  return (
    <div className="min-h-dvh bg-nett-black">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-nett-surface focus:px-4 focus:py-2 focus:shadow-lift">
        Pular para o conteúdo
      </a>

      {/* Barra lateral — desktop */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col justify-between bg-nett-black px-4 py-5 lg:flex">
        <div className="space-y-8">
          <div className="px-1">
            <Marca />
          </div>
          <Navegacao />
        </div>
        <CartaoEmpresa />
      </aside>

      {/* Barra superior — mobile */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between bg-nett-black px-4 lg:hidden">
        <Marca />
        <button
          type="button"
          onClick={() => setMenuAberto(true)}
          className="flex size-10 items-center justify-center rounded-xl text-nett-text hover:bg-nett-text/10"
          aria-label="Abrir menu"
          aria-expanded={menuAberto}
        >
          <IconMenu size={22} />
        </button>
      </header>

      {menuAberto ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-nett-black/60" aria-label="Fechar menu" onClick={() => setMenuAberto(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-[fade-in_0.2s_ease-out_both] flex-col justify-between overflow-y-auto bg-nett-black px-4 py-5">
            <div className="space-y-8">
              <div className="flex items-center justify-between px-1">
                <Marca />
                <button
                  type="button"
                  onClick={() => setMenuAberto(false)}
                  className="flex size-9 items-center justify-center rounded-xl text-nett-text-muted hover:bg-nett-text/10"
                  aria-label="Fechar menu"
                >
                  <IconX size={20} />
                </button>
              </div>
              <Navegacao onNavigate={() => setMenuAberto(false)} />
            </div>
            <div className="pt-6">
              <CartaoEmpresa />
            </div>
          </div>
        </div>
      ) : null}

      <main id="conteudo" className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
