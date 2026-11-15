'use client';

import { useEffect } from 'react';
import { IconAlert, IconRefresh } from '@/components/icons';

/**
 * Limite de erro da aplicação (em português).
 * Evita a tela "Application error: a server-side exception has occurred" em
 * inglês quando algo inesperado acontece na renderização do servidor.
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // O detalhe técnico fica no console do navegador para quem estiver depurando.
    console.error('[Analisador de Editais] erro de renderização:', error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-nett-black px-5 py-16">
      <div className="w-full max-w-lg rounded-3xl border border-nett-text-muted/15 bg-nett-surface p-8 text-center shadow-lift">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-nett-text/6 text-nett-text">
          <IconAlert size={24} />
        </span>

        <h1 className="mt-5 text-2xl font-semibold text-nett-text">Não foi possível exibir esta página</h1>

        <p className="mt-3 text-[15px] leading-relaxed text-nett-text">
          Ocorreu um erro inesperado ao montar a tela. O documento enviado não é afetado — na maioria dos casos basta
          tentar novamente.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-nett-gold px-5 py-3 text-sm font-medium text-nett-black shadow-soft transition hover:bg-nett-gold-light"
          >
            <IconRefresh size={16} />
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-nett-text-muted/15 px-5 py-3 text-sm font-medium text-nett-text transition hover:border-nett-text-muted/30 hover:bg-nett-black"
          >
            Voltar ao início
          </a>
        </div>

        <p className="mt-6 text-xs text-nett-text-muted">
          Se o erro persistir, verifique o terminal onde a aplicação está em execução.
        </p>
      </div>
    </main>
  );
}
