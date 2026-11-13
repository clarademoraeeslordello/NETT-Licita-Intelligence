'use client';

import { useEffect, useRef, useState } from 'react';
import { IconAlert, IconCheckCircle, IconDownload, IconPrint } from '@/components/icons';

/** Botão de download do PDF do relatório, com estados de carregamento e erro. */
export function ReportActions({
  jobId,
  pdfAvailable,
  fileName,
}: {
  jobId: string;
  pdfAvailable: boolean;
  fileName: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revokeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      if (revokeTimer.current) clearTimeout(revokeTimer.current);
    },
    [],
  );

  const download = async () => {
    // Sem gerador de PDF no servidor: abre a versão de impressão já com a janela
    // "Salvar como PDF" aberta — o layout é o mesmo do arquivo gerado.
    if (!pdfAvailable) {
      window.open(`/api/jobs/${jobId}/report.html?imprimir=1`, '_blank', 'noopener');
      return;
    }
    setState('loading');
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/report`, { cache: 'no-store' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string; hint?: string } }
          | null;
        setMessage(payload?.error?.hint ?? payload?.error?.message ?? 'Falha ao gerar o PDF.');
        setState('error');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revogar imediatamente pode abortar o download em alguns navegadores.
      revokeTimer.current = setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setState('done');
      resetTimer.current = setTimeout(() => setState('idle'), 3000);
    } catch {
      setMessage('Não foi possível baixar o PDF. Verifique a conexão com o servidor.');
      setState('error');
    }
  };

  return (
    <div className="no-print">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={download}
          disabled={state === 'loading'}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-soft transition hover:bg-brand-700 disabled:cursor-wait disabled:bg-brand-400"
        >
          <IconDownload size={17} />
          <span className="hidden sm:inline">
            {state === 'loading' ? 'Gerando PDF…' : state === 'done' ? 'PDF baixado' : 'Baixar relatório em PDF'}
          </span>
          <span className="sm:hidden">{state === 'loading' ? 'Gerando…' : 'PDF'}</span>
        </button>

        <a
          href={`/api/jobs/${jobId}/report.html`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Abrir versão de impressão do relatório em uma nova aba"
          className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:bg-ink-50"
        >
          <IconPrint size={16} />
          <span className="hidden sm:inline">Abrir versão de impressão</span>
        </a>
      </div>

      {!pdfAvailable ? (
        <p className="mt-2 text-xs text-ink-500">
          O PDF abre numa nova aba: escolha <strong>“Salvar como PDF”</strong> como impressora.
        </p>
      ) : null}

      {state === 'error' && message ? (
        <p className="mt-2 flex items-start gap-2 text-xs text-danger-700" role="alert">
          <IconAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            {message} Use <strong>“Abrir versão de impressão”</strong> como alternativa.
          </span>
        </p>
      ) : null}

      {state === 'done' ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-ok-700" role="status">
          <IconCheckCircle size={14} />
          Arquivo salvo na pasta de downloads.
        </p>
      ) : null}
    </div>
  );
}
