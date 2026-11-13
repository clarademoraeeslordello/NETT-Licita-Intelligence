'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  IconAlert,
  IconCheckCircle,
  IconDocument,
  IconDownload,
  IconLock,
  IconPlay,
  IconSparkles,
  IconUpload,
} from '@/components/icons';
import { DEFAULT_STEPS, ProgressTimeline, type ProgressEvent, type StepState } from '@/components/progress-timeline';
import type { Capabilities } from '@/lib/api-types';
import { formatBytes } from '@/lib/ui-format';
import { cabecalhoDispositivo } from '@/lib/dispositivo';

type CotaIa = { ia: boolean; limite?: number; restantes?: number; janelaHoras?: number; liberaEm?: string | null };

type ErrorState = { code?: string; message: string; hint?: string } | null;

const ACCEPTED = ['application/pdf', 'application/x-pdf'];

/** Rótulos em português para as chaves técnicas de metadados do servidor. */
const META_LABEL: Record<string, string> = {
  pages: 'páginas',
  chars: 'caracteres',
  words: 'palavras',
};

/**
 * Fluxo principal: selecionar PDF → analisar → acompanhar → abrir relatório.
 * Toda a análise acontece no servidor; o cliente apenas acompanha o SSE.
 */
export type OrigemPncp = { cnpj: string; ano: string; seq: string };

export function AnalyzeWorkspace({
  capabilities,
  origemPncp = null,
}: {
  capabilities: Capabilities;
  /** Quando presente, baixa o edital do PNCP e inicia a análise automaticamente. */
  origemPncp?: OrigemPncp | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const redirectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'idle' | 'running' | 'error'>('idle');
  const [steps, setSteps] = useState<StepState[]>(DEFAULT_STEPS.map((step) => ({ ...step })));
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<ErrorState>(null);
  const [meta, setMeta] = useState<Record<string, string | number>>({});
  const [success, setSuccess] = useState(false);
  const [engine, setEngine] = useState<string | null>(null);
  const [resultJobId, setResultJobId] = useState<string | null>(null);
  const [pncpFileName, setPncpFileName] = useState<string | null>(null);
  const pncpIniciado = useRef(false);

  // Limpa timers e requisição em andamento ao desmontar: sem isso, um
  // redirecionamento agendado poderia disparar depois da saída do componente.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (redirectRef.current) clearTimeout(redirectRef.current);
    },
    [],
  );

  // Leva o foco para a trilha quando o processamento começa, para que usuários
  // de teclado e leitores de tela não fiquem "perdidos" após o botão sumir.
  useEffect(() => {
    if (phase === 'running' && timelineRef.current) {
      timelineRef.current.focus();
    }
  }, [phase]);

  const reset = useCallback(() => {
    setSteps(DEFAULT_STEPS.map((step) => ({ ...step })));
    setEvents([]);
    setProgress(0);
    setError(null);
    setMeta({});
    setSuccess(false);
    setEngine(null);
    setResultJobId(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (redirectRef.current) clearTimeout(redirectRef.current);
    reset();
    setPncpFileName(null);
    setPhase('idle');
  }, [reset]);

  const pickFile = useCallback(
    (candidate: File | null | undefined) => {
      if (!candidate) return;
      setError(null);

      // Só aceitamos PDF: validar o nome evita deixar passar arquivos com MIME
      // vazio ou genérico e falhar apenas no servidor.
      const isPdf = ACCEPTED.includes(candidate.type) || /\.pdf$/i.test(candidate.name);
      if (!isPdf) {
        setError({
          code: 'INVALID_FILE_TYPE',
          message: 'Formato não aceito.',
          hint: 'Envie um arquivo PDF com texto selecionável.',
        });
        return;
      }
      if (candidate.size === 0) {
        setError({ code: 'EMPTY_FILE', message: 'O arquivo está vazio.', hint: 'Selecione outro arquivo.' });
        return;
      }
      if (candidate.size > capabilities.limits.maxUploadMb * 1024 * 1024) {
        setError({
          code: 'FILE_TOO_LARGE',
          message: `O arquivo tem ${formatBytes(candidate.size)} e o limite é ${capabilities.limits.maxUploadMb} MB.`,
          hint: 'Reduza o PDF ou aumente MAX_UPLOAD_MB no .env do servidor.',
        });
        return;
      }
      setFile(candidate);
    },
    [capabilities.limits.maxUploadMb],
  );

  /** Consome o stream SSE do endpoint de análise. */
  const stream = useCallback(
    async (response: Response) => {
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { code?: string; message?: string; hint?: string } }
          | null;
        setError({
          code: payload?.error?.code,
          message: payload?.error?.message ?? 'Não foi possível iniciar a análise.',
          hint: payload?.error?.hint,
        });
        setPhase('error');
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setError({ message: 'O servidor não retornou um stream de progresso.' });
        setPhase('error');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      let replayed = response.headers.get('X-Job-Reused') === '1';

      // Watchdog de inatividade: se o servidor parar de enviar eventos, a
      // interface sai do estado de carregamento em vez de esperar para sempre.
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      const armWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (finished) return;
          setError({
            message: 'A análise parou de responder.',
            hint: 'O servidor pode estar sobrecarregado. Tente novamente.',
          });
          setPhase('error');
          void reader.cancel().catch(() => undefined);
        }, 90_000);
      };
      armWatchdog();

      const handleBlock = (block: string) => {
        if (finished) return;
        armWatchdog();
        const eventMatch = /^event: (.+)$/m.exec(block);
        const dataMatch = /^data: (.+)$/m.exec(block);
        if (!dataMatch) return;
        const eventName = eventMatch?.[1] ?? 'update';

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(dataMatch[1]) as Record<string, unknown>;
        } catch {
          return;
        }

        if (eventName === 'state') {
          const job = payload.job as
            | { steps?: StepState[]; progress?: number; stage?: string; replayed?: boolean }
            | undefined;
          if (job?.steps) setSteps(job.steps);
          if (typeof job?.progress === 'number') setProgress(job.progress);
          return;
        }

        if (eventName === 'done') {
          finished = true;
          if (watchdog) clearTimeout(watchdog);
          if (payload.reused) replayed = true;
          setProgress(100);
          setSteps((previous) => previous.map((step) => ({ ...step, status: 'done' })));
          setSuccess(true);
          const jobId = String(payload.jobId ?? '');
          if (!jobId) {
            setError({
              message: 'O servidor concluiu a análise sem informar o identificador do resultado.',
              hint: 'Recarregue a página e envie o documento novamente.',
            });
            setPhase('error');
            return;
          }
          setResultJobId(jobId);
          // Pequena pausa para o usuário ver a conclusão antes do redirecionamento.
          redirectRef.current = setTimeout(() => router.push(`/analise/${jobId}`), replayed ? 350 : 700);
          return;
        }

        if (eventName === 'error') {
          const job = payload.job as { error?: ErrorState } | undefined;
          setError(
            job?.error ?? {
              message: String(payload.message ?? 'Falha no processamento.'),
              hint: typeof payload.hint === 'string' ? payload.hint : undefined,
            },
          );
          setPhase('error');
          return;
        }

        const event = payload as unknown as ProgressEvent;
        setProgress((previous) => Math.max(previous, Number(event.progress ?? 0)));
        if (event.steps) setSteps(event.steps);
        if (event.meta) setMeta((previous) => ({ ...previous, ...event.meta }));
        // Mantém apenas os eventos recentes: editais longos geram centenas.
        setEvents((previous) => [...previous, event].slice(-200));
      };

      try {
        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            if (!block.trim() || block.startsWith(':')) continue;
            handleBlock(block);
          }
        }
      } catch {
        // Queda de conexão no meio do stream: tratada como erro explícito.
        if (!finished) {
          setError({
            message: 'A conexão com o servidor foi interrompida.',
            hint: 'Verifique a rede e tente novamente.',
          });
          setPhase('error');
        }
        return;
      } finally {
        if (watchdog) clearTimeout(watchdog);
      }

      // O stream terminou sem evento de conclusão: sem isso a interface ficaria
      // presa em "processando" para sempre.
      if (!finished) {
        setError({
          message: 'A análise foi encerrada antes da conclusão.',
          hint: 'Tente novamente. Se persistir, verifique os logs do servidor.',
        });
        setPhase('error');
      }
    },
    [router],
  );

  const runUpload = useCallback(async () => {
    if (!file || phase !== 'idle') return;
    reset();
    setPhase('running');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: cabecalhoDispositivo(),
        body: formData,
        signal: controller.signal,
      });
      setEngine(response.headers.get('X-Job-Reused') === '1' ? 'reused' : 'new');
      await stream(response);
    } catch (fetchError) {
      if ((fetchError as Error).name === 'AbortError') return;
      setError({
        message: 'Falha de comunicação com o servidor.',
        hint: 'Verifique se a aplicação está em execução e tente novamente.',
      });
      setPhase('error');
    }
  }, [file, phase, reset, stream]);

  const runDemo = useCallback(async () => {
    if (phase !== 'idle') return;
    reset();
    setPhase('running');
    setFile(null);
    setPncpFileName(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/analyze/demo', { method: 'POST', signal: controller.signal });
      setEngine(response.headers.get('X-Job-Reused') === '1' ? 'reused' : 'new');
      await stream(response);
    } catch (fetchError) {
      if ((fetchError as Error).name === 'AbortError') return;
      setError({
        message: 'Não foi possível iniciar a demonstração.',
        hint: 'Verifique se a aplicação está em execução.',
      });
      setPhase('error');
    }
  }, [phase, reset, stream]);

  const runPncp = useCallback(
    async (origem: OrigemPncp) => {
      reset();
      setPhase('running');
      setFile(null);
      setPncpFileName(`Edital PNCP ${origem.cnpj}/${origem.ano}/${origem.seq}`);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/pncp/analisar', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...cabecalhoDispositivo() },
          body: JSON.stringify(origem),
          signal: controller.signal,
        });
        const nome = response.headers.get('X-File-Name');
        if (nome) setPncpFileName(decodeURIComponent(nome));
        setEngine(response.headers.get('X-Job-Reused') === '1' ? 'reused' : 'new');
        await stream(response);
      } catch (fetchError) {
        if ((fetchError as Error).name === 'AbortError') return;
        setError({
          message: 'Não foi possível baixar o edital do PNCP.',
          hint: 'Verifique a conexão e tente novamente.',
        });
        setPhase('error');
      }
    },
    [reset, stream],
  );

  // Análise disparada pelo Radar: começa sozinha, uma única vez. O timer evita
  // a requisição duplicada do ciclo montar→desmontar→montar do StrictMode.
  useEffect(() => {
    if (!origemPncp || pncpIniciado.current) return;
    const timer = setTimeout(() => {
      pncpIniciado.current = true;
      void runPncp(origemPncp);
    }, 0);
    return () => clearTimeout(timer);
  }, [origemPncp, runPncp]);

  const running = phase === 'running';
  const aiOn = capabilities.ai.configured;

  // Cota de análises com IA desta pessoa: recarrega ao abrir e ao voltar ao formulário.
  const [cota, setCota] = useState<CotaIa | null>(null);
  useEffect(() => {
    if (!aiOn || phase !== 'idle') return;
    let ativo = true;
    fetch('/api/cota', { headers: cabecalhoDispositivo(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((dados: CotaIa | null) => ativo && setCota(dados))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [aiOn, phase]);

  if (running || phase === 'error' || success) {
    return (
      <div className="space-y-4">
        <div ref={timelineRef} tabIndex={-1} className="outline-none">
          <ProgressTimeline
            steps={steps}
            events={events}
            progress={success ? 100 : progress}
            fileName={file?.name ?? pncpFileName ?? capabilities.demo.fileName}
            fileSizeLabel={file ? formatBytes(file.size) : ''}
            isDemo={!file && !pncpFileName}
            error={phase === 'error' ? error : null}
            onRetry={() => {
              reset();
              setPncpFileName(null);
              setPhase('idle');
            }}
          />
        </div>

        {success ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-ok-100 bg-ok-100/40 px-5 py-4 text-sm text-ok-700"
          >
            <IconCheckCircle size={20} />
            <span>
              Análise concluída
              {engine === 'reused' ? ' — resultado desta sessão reaproveitado, sem novo processamento' : ''}. Abrindo
              o relatório…
            </span>
            {resultJobId ? (
              <Link
                href={`/analise/${resultJobId}`}
                className="rounded-xl bg-ok-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-ok-700/90"
              >
                Abrir o relatório agora
              </Link>
            ) : null}
          </div>
        ) : null}

        {running ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={cancel}
              className="rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-600 transition hover:border-ink-300 hover:text-ink-900"
            >
              Cancelar análise
            </button>
            <p className="text-xs text-ink-500" role="status" aria-live="polite">
              Progresso: {Math.round(progress)}%
            </p>
          </div>
        ) : null}

        {phase === 'error' ? null : (
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <IconLock size={14} /> documento processado apenas no servidor
            </span>
            {Object.entries(meta).map(([key, value]) => (
              <span key={key} className="rounded-full bg-white px-3 py-1 shadow-ring">
                {META_LABEL[key] ?? key}:{' '}
                <strong className="font-medium text-ink-700">
                  {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
                </strong>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="enviar-edital" className="scroll-mt-24 rounded-3xl border border-ink-200 bg-white p-6 shadow-lift sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Envie o edital</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            PDF com texto selecionável, até {capabilities.limits.maxUploadMb} MB e {capabilities.limits.maxPages}{' '}
            páginas.
          </p>
          {cota?.ia && cota.limite ? (
            <p className={`mt-1 text-xs font-medium ${cota.restantes ? 'text-ink-600' : 'text-warn-700'}`}>
              {cota.restantes
                ? `Você tem ${cota.restantes} de ${cota.limite} análises com IA disponíveis · a cota renova a cada ${Math.round((cota.janelaHoras ?? 72) / 24)} dias`
                : `Suas ${cota.limite} análises com IA foram usadas${
                    cota.liberaEm
                      ? ` · a próxima libera em ${new Date(cota.liberaEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                      : ''
                  }. O edital de demonstração continua liberado.`}
            </p>
          ) : null}
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
            aiOn ? 'bg-brand-50 text-brand-700' : 'bg-warn-100/60 text-warn-700'
          }`}
          title={
            aiOn
              ? `Análise por IA habilitada (${capabilities.ai.model})`
              : 'Sem chave de IA: o servidor usará o motor local de demonstração'
          }
        >
          <IconSparkles size={14} />
          {aiOn ? `IA ativa · ${capabilities.ai.model}` : 'Motor local (demo)'}
        </span>
      </div>

      <div
        onClick={(event) => {
          // Não abre o seletor quando o clique veio de um botão interno.
          if ((event.target as HTMLElement).closest('button')) return;
          inputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          // Só encerra o destaque quando o ponteiro sai da zona por completo —
          // sem isso, passar sobre um filho pisca o estado visual.
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          pickFile(event.dataTransfer.files?.[0]);
        }}
        role="button"
        tabIndex={0}
        aria-label="Selecionar o arquivo PDF do edital"
        className={`mt-6 cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragging ? 'border-brand-400 bg-brand-50/60' : 'border-ink-200 bg-ink-50/60'
        }`}
      >
        <input
          ref={inputRef}
          id="edital-pdf"
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            pickFile(event.target.files?.[0]);
            // Permite reenviar o mesmo arquivo depois de um erro de validação.
            event.target.value = '';
          }}
        />

        {file ? (
          <div className="flex flex-col items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-soft">
              <IconDocument size={24} />
            </span>
            <div>
              <p className="font-medium text-ink-900">{file.name}</p>
              <p className="text-sm text-ink-500">
                {formatBytes(file.size)} · pronto para análise
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:bg-ink-50"
              >
                Trocar arquivo
              </button>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setError(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                className="rounded-xl px-3 py-2 text-sm text-ink-500 transition hover:text-ink-800"
              >
                Remover
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-soft">
              <IconUpload size={24} />
            </span>
            <div>
              <p className="font-medium text-ink-900">Arraste o PDF aqui</p>
              <p className="text-sm text-ink-500">ou clique para selecionar no seu computador</p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:bg-ink-50"
            >
              Selecionar arquivo
            </button>
            <p className="text-xs text-ink-500">Formato aceito: PDF · máx. {capabilities.limits.maxUploadMb} MB</p>
          </div>
        )}
      </div>

      {error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-5 flex items-start gap-3 rounded-2xl border border-danger-100 bg-danger-100/40 p-4"
        >
          <span className="mt-0.5 text-danger-600">
            <IconAlert size={20} />
          </span>
          <div>
            <p className="text-sm font-medium text-danger-700">{error.message}</p>
            {error.hint ? <p className="mt-1 text-sm text-danger-700/80">{error.hint}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={!file}
          onClick={runUpload}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3.5 font-medium text-white shadow-soft transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500 disabled:shadow-none sm:flex-none"
        >
          <IconSparkles size={18} />
          Analisar edital
        </button>

        <button
          type="button"
          onClick={runDemo}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-5 py-3.5 font-medium text-ink-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
        >
          <IconPlay size={16} />
          Analisar edital de demonstração
        </button>

        <a
          href="/api/demo/edital?download=1"
          className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm text-ink-500 transition hover:text-ink-800"
        >
          <IconDownload size={16} />
          Baixar PDF de teste
        </a>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-500">
        O PDF é processado no servidor e não é guardado nem publicado. O relatório fica disponível pelo link por 30
        dias.
      </p>
    </div>
  );
}
