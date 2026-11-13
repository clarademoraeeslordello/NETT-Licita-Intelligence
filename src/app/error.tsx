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
    <main className="flex min-h-dvh items-center justify-center bg-ink-50 px-5 py-16">
      <div className="w-full max-w-lg rounded-3xl border border-ink-200 bg-white p-8 text-center shadow-lift">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-danger-100/60 text-danger-700">
          <IconAlert size={24} />
        </span>

        <h1 className="mt-5 text-2xl font-semibold text-ink-900">Não foi possível exibir esta página</h1>

        <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
          Ocorreu um erro inesperado ao montar a tela. O documento enviado não é afetado — na maioria dos casos basta
          tentar novamente.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-medium text-white shadow-soft transition hover:bg-brand-700"
          >
            <IconRefresh size={16} />
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-ink-200 px-5 py-3 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:bg-ink-50"
          >
            Voltar ao início
          </a>
        </div>

        <p className="mt-6 text-xs text-ink-500">
          Se o erro persistir, verifique o terminal onde a aplicação está em execução.
        </p>
      </div>
    </main>
  );
}
