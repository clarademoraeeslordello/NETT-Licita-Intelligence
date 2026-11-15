'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconAlert, IconCheck, IconSparkles } from '@/components/icons';

export type StepState = {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
};

export type ProgressEvent = {
  stage: string;
  progress: number;
  message: string;
  detail?: string | null;
  at: number;
  steps?: StepState[];
  meta?: Record<string, string | number>;
  fileName?: string;
  isDemo?: boolean;
};

const DEFAULT_STEPS: StepState[] = [
  { id: 'received', label: 'Documento recebido', status: 'pending' },
  { id: 'extracting', label: 'Extraindo conteúdo', status: 'pending' },
  { id: 'analyzing', label: 'Analisando edital', status: 'pending' },
  { id: 'structuring', label: 'Estruturando informações', status: 'pending' },
  { id: 'reporting', label: 'Gerando relatório', status: 'pending' },
];

function StepIcon({ status }: { status: StepState['status'] }) {
  if (status === 'done') {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-nett-gold text-nett-black shadow-sm">
        <IconCheck size={15} />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-nett-text text-nett-black shadow-sm">
        <IconAlert size={15} />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-nett-gold text-nett-black shadow-sm animate-[pulse-ring_2s_ease-out_infinite]">
        <span className="size-2.5 animate-pulse rounded-full bg-nett-surface" />
      </span>
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-nett-text-muted/15 bg-nett-surface">
      <span className="size-2 rounded-full bg-nett-text-muted/30" />
    </span>
  );
}

/** Trilha de etapas + console de progresso em tempo real. */
export function ProgressTimeline({
  steps,
  events,
  progress,
  fileName,
  fileSizeLabel,
  isDemo,
  error,
  onRetry,
}: {
  steps: StepState[];
  events: ProgressEvent[];
  progress: number;
  fileName: string;
  fileSizeLabel: string;
  isDemo: boolean;
  error?: { code?: string; message: string; hint?: string } | null;
  onRetry: () => void;
}) {
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight, behavior: 'smooth' });
  }, [events.length]);

  const current = steps.find((step) => step.status === 'active') ?? steps.find((step) => step.status === 'pending');

  return (
    <div className="animate-[fade-up_0.4s_ease-out_both] rounded-3xl border border-nett-text-muted/15 bg-nett-surface p-6 shadow-soft sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-nett-gold/10 text-nett-gold">
            <IconSparkles size={22} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-nett-text" title={fileName}>
              {fileName}
            </p>
            <p className="text-sm text-nett-text-muted">
              {fileSizeLabel}
              {isDemo ? ' · documento de demonstração' : ''}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold tabular-nums text-nett-text">{Math.round(progress)}%</p>
          <p className="text-xs uppercase tracking-[0.14em] text-nett-text-muted">progresso</p>
        </div>
      </div>

      <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-nett-raised">
        <div
          className="h-full rounded-full bg-gradient-to-r from-nett-gold to-nett-gold transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(3, Math.min(100, progress))}%` }}
        />
      </div>

      <p className="mt-5 text-sm font-medium text-nett-text">
        {error ? 'Processamento interrompido' : (current?.label ?? 'Concluído')}
      </p>

      <ol className="mt-4 space-y-3">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3">
            <StepIcon status={step.status} />
            <div className="min-w-0 pt-0.5">
              <p
                className={`text-sm ${
                  step.status === 'pending' ? 'text-nett-text-muted' : 'font-medium text-nett-text'
                }`}
              >
                {step.label}
              </p>
              {step.detail ? <p className="mt-0.5 text-xs text-nett-text-muted">{step.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>

      <div
        ref={consoleRef}
        className="scrollbar-slim mt-6 max-h-40 overflow-y-auto rounded-2xl border border-nett-text-muted/15 bg-nett-black p-4 font-mono text-[12px] leading-relaxed text-nett-text-muted"
      >
        {events.map((event, index) => (
          <div key={`${event.at}-${index}`} className="flex gap-3">
            <span className="shrink-0 text-nett-text-muted">
              {new Date(event.at).toLocaleTimeString('pt-BR', { hour12: false })}
            </span>
            <span className="text-nett-text">{event.message}</span>
            {event.detail ? <span className="text-nett-text-muted">{event.detail}</span> : null}
          </div>
        ))}
        {!error && !steps.every((step) => step.status === 'done') ? (
          <div className="mt-1 text-nett-gold-light">▌</div>
        ) : null}
      </div>

      {error ? (
        <div className="mt-6 rounded-2xl border border-nett-text/20 bg-nett-text/4 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-nett-text">
              <IconAlert size={20} />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-nett-text">{error.message}</p>
              {error.hint ? <p className="mt-1 text-sm text-nett-text/80">{error.hint}</p> : null}
              {error.code ? (
                <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-nett-text/70">
                  código: {error.code}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-xl bg-nett-raised px-4 py-2 text-sm font-medium text-nett-text transition hover:bg-nett-raised"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}
    </div>
  );
}

export { DEFAULT_STEPS };
export function useResetSteps() {
  return useCallback(() => DEFAULT_STEPS.map((step) => ({ ...step })), []);
}
