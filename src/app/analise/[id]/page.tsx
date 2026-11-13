import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IconChevron, IconClock, IconLayers, IconSparkles } from '@/components/icons';
import { ReportActions } from '@/components/report-actions';
import { ReportToc, type TocEntry } from '@/components/report-toc';
import { ReportView } from '@/components/report-view';
import { getCapabilities } from '@/lib/capabilities';
import { reportFileName } from '@/lib/report/document';
import { obterAnalise } from '@/lib/persistencia';
import { formatBytes, formatDateTimeLabel, pluralize } from '@/lib/ui-format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Relatório de análise',
};

type PageProps = { params: Promise<{ id: string }> };

export default async function AnalysisPage({ params }: PageProps) {
  const { id } = await params;
  const found = await obterAnalise(id);
  if (!found) notFound();

  const { job, analise } = found;
  const meta =
    job.result?.meta ?? { engine: 'local-demo' as const, avisos: [], chunks: 1, llmCalls: 0, tokensEstimados: 0 };
  const capabilities = await getCapabilities();

  const toc: TocEntry[] = [
    { id: 'resumo', label: '1. Resumo Executivo' },
    { id: 'informacoes-gerais', label: '2. Informações Gerais' },
    {
      id: 'cronograma',
      label: '3. Cronograma',
      count: analise.cronograma.length + (analise.outrosPrazos?.length ?? 0) || null,
    },
    { id: 'objeto', label: '4. Objeto', count: analise.objeto.itens?.length || null },
    { id: 'participacao', label: '5. Participação' },
    { id: 'obrigacoes', label: '6. Obrigações' },
    { id: 'valores', label: '7. Valores' },
    {
      id: 'pontos-de-atencao',
      label: '8. Pontos de Atenção',
      count: analise.pontosDeAtencao.length || null,
    },
    { id: 'checklist', label: '9. Checklist', count: analise.checklist.length || null },
    { id: 'conclusao', label: '10. Conclusão' },
  ];

  const motorLabel =
    meta.engine === 'deepseek'
      ? `IA · ${meta.model ?? capabilities.ai.model}`
      : 'Motor local (demonstração)';

  return (
    <div className="min-h-dvh bg-ink-50">
      {/* ------------------------------- Header ------------------------------ */}
      <header className="sticky top-0 z-40 border-b border-ink-200/70 glass no-print">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="flex items-center gap-3" aria-label="Voltar ao painel do LicitaFlow">
              <span className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-brand-400 to-brand-700 text-white shadow-soft">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 19 12 5l7 14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M8.5 13.5h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </span>
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-ink-900" title={job.fileName}>
                  {job.fileName}
                </p>
                {job.isDemo ? (
                  <span className="shrink-0 rounded-full bg-warn-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warn-700">
                    demonstração
                  </span>
                ) : null}
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
                <span>{formatBytes(job.fileSize)}</span>
                <span className="text-ink-300">·</span>
                <span>{pluralize(analise.documento.paginas ?? 0, 'página', 'páginas')}</span>
                <span className="text-ink-300">·</span>
                <span>{formatDateTimeLabel(job.createdAt)}</span>
                <span className="text-ink-300">·</span>
                <span className="inline-flex items-center gap-1">
                  <IconSparkles size={12} />
                  {motorLabel}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ReportActions
              jobId={job.id}
              pdfAvailable={capabilities.report.pdfAvailable}
              fileName={reportFileName(analise)}
            />
            <Link
              href="/analisador"
              className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm font-medium text-ink-600 transition hover:border-ink-300 hover:text-ink-900"
            >
              <IconChevron size={15} className="rotate-180" />
              Novo edital
            </Link>
          </div>
        </div>
      </header>

      {/* ------------------------------- Avisos ------------------------------ */}
      {meta.engine !== 'deepseek' ? (
        <div className="no-print mx-auto max-w-7xl px-5 pt-5">
          <div className="rounded-2xl border border-warn-100 bg-warn-100/40 px-5 py-4 text-sm text-warn-700">
            <p className="font-semibold">Análise produzida pelo motor local de demonstração</p>
            <p className="mt-1 leading-relaxed">
              Sem <code className="font-mono">DEEPSEEK_API_KEY</code> configurada, o sistema usa extração determinística
              de padrões (sem IA generativa). Os campos marcados como ausentes exigem leitura humana. Configure a chave
              no <code className="font-mono">.env</code> para habilitar a análise completa por IA.
            </p>
          </div>
        </div>
      ) : null}

      {meta.avisos.length ? (
        <div className="no-print mx-auto max-w-7xl px-5 pt-5">
          <div className="rounded-2xl border border-ink-200 bg-white px-5 py-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-800">
              <IconLayers size={15} />
              Observações do processamento
            </p>
            <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-ink-500">
              {meta.avisos.map((aviso, index) => (
                <li key={index}>• {aviso}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* ------------------------------ Conteúdo ----------------------------- */}
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="no-print xl:pt-1">
          <ReportToc entries={toc} />

          <div className="mt-5 hidden rounded-2xl border border-ink-200 bg-white p-4 xl:block">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">Resumo técnico</p>
            <dl className="mt-3 space-y-2.5 text-[13px]">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-500">Motor</dt>
                <dd className="text-right font-medium text-ink-800">{meta.engine === 'deepseek' ? 'IA (LLM)' : 'Local'}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-500">Blocos analisados</dt>
                <dd className="font-mono font-medium text-ink-800">{meta.chunks ?? 1}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-500">Chamadas ao modelo</dt>
                <dd className="font-mono font-medium text-ink-800">{meta.llmCalls ?? 0}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-500">Tokens</dt>
                <dd className="font-mono font-medium text-ink-800">
                  {(meta.tokensEstimados ?? 0).toLocaleString('pt-BR')}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-500">Tempo</dt>
                <dd className="font-mono font-medium text-ink-800">
                  {meta.duracaoMs ? `${(meta.duracaoMs / 1000).toFixed(1)} s` : '—'}
                </dd>
              </div>
              {typeof meta.custoEstimadoUSD === 'number' && meta.custoEstimadoUSD > 0 ? (
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-ink-500">Custo estimado</dt>
                  <dd className="font-mono font-medium text-ink-800">US$ {meta.custoEstimadoUSD.toFixed(4)}</dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-3 flex items-start gap-2 border-t border-ink-100 pt-3 text-[11px] leading-relaxed text-ink-500">
              <IconClock size={12} className="mt-0.5 shrink-0" />
              Relatório disponível neste link por 30 dias. O PDF enviado não é guardado.
            </p>
          </div>
        </aside>

        <main className="min-w-0">
          <ReportView analise={analise} fileName={job.fileName} isDemo={job.isDemo} />
        </main>
      </div>
    </div>
  );
}
