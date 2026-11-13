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
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ok-500 text-white shadow-sm">
        <IconCheck size={15} />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-danger-500 text-white shadow-sm">
        <IconAlert size={15} />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm animate-[pulse-ring_2s_ease-out_infinite]">
        <span className="size-2.5 animate-pulse rounded-full bg-white" />
      </span>
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white">
      <span className="size-2 rounded-full bg-ink-300" />
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
    <div className="animate-[fade-up_0.4s_ease-out_both] rounded-3xl border border-ink-200 bg-white p-6 shadow-soft sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <IconSparkles size={22} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900" title={fileName}>
              {fileName}
            </p>
            <p className="text-sm text-ink-500">
              {fileSizeLabel}
              {isDemo ? ' · documento de demonstração' : ''}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold tabular-nums text-ink-900">{Math.round(progress)}%</p>
          <p className="text-xs uppercase tracking-[0.14em] text-ink-500">progresso</p>
        </div>
      </div>

      <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(3, Math.min(100, progress))}%` }}
        />
      </div>

      <p className="mt-5 text-sm font-medium text-ink-800">
        {error ? 'Processamento interrompido' : (current?.label ?? 'Concluído')}
      </p>

      <ol className="mt-4 space-y-3">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3">
            <StepIcon status={step.status} />
            <div className="min-w-0 pt-0.5">
              <p
                className={`text-sm ${
                  step.status === 'pending' ? 'text-ink-500' : 'font-medium text-ink-800'
                }`}
              >
                {step.label}
              </p>
              {step.detail ? <p className="mt-0.5 text-xs text-ink-500">{step.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>

      <div
        ref={consoleRef}
        className="scrollbar-slim mt-6 max-h-40 overflow-y-auto rounded-2xl border border-ink-200 bg-ink-950 p-4 font-mono text-[12px] leading-relaxed text-ink-300"
      >
        {events.map((event, index) => (
          <div key={`${event.at}-${index}`} className="flex gap-3">
            <span className="shrink-0 text-ink-500">
              {new Date(event.at).toLocaleTimeString('pt-BR', { hour12: false })}
            </span>
            <span className="text-ink-100">{event.message}</span>
            {event.detail ? <span className="text-ink-500">{event.detail}</span> : null}
          </div>
        ))}
        {!error && !steps.every((step) => step.status === 'done') ? (
          <div className="mt-1 text-brand-300">▌</div>
        ) : null}
      </div>

      {error ? (
        <div className="mt-6 rounded-2xl border border-danger-100 bg-danger-100/40 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-danger-600">
              <IconAlert size={20} />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-danger-700">{error.message}</p>
              {error.hint ? <p className="mt-1 text-sm text-danger-700/80">{error.hint}</p> : null}
              {error.code ? (
                <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-danger-700/70">
                  código: {error.code}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-xl bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
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
