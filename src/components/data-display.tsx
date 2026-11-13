import type { Evidence, SourcedItem } from '@/lib/schema';
import { STATUS_HINT, STATUS_LABEL } from '@/lib/ui-format';
import { IconAlert, IconCheck, IconQuestion } from '@/components/icons-mini';

/** Badge que explicita a natureza da informação: encontrada, inferida ou ausente. */
export function StatusChip({ status, compact = false }: { status?: string; compact?: boolean }) {
  const key = status ?? 'not_found';
  const tone =
    key === 'found'
      ? 'bg-ok-100 text-ok-700'
      : key === 'inferred'
        ? 'bg-warn-100 text-warn-700'
        : 'bg-ink-100 text-ink-600';

  const Icon = key === 'found' ? IconCheck : key === 'inferred' ? IconAlert : IconQuestion;

  return (
    <span
      title={STATUS_HINT[key]}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}
    >
      <Icon size={12} />
      {compact ? STATUS_LABEL[key].replace('Não identificado', 'Ausente') : STATUS_LABEL[key]}
    </span>
  );
}

/** Marcador de origem da informação (página / seção do edital). */
export function SourceBadge({ source }: { source?: string | null }) {
  if (!source) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
      {source}
    </span>
  );
}

/**
 * Linha de dado estruturado: rótulo, valor, status e origem.
 * Usada nas tabelas de informações gerais e obrigações.
 */
export function DataRow({
  label,
  evidence,
  hint,
}: {
  label: string;
  evidence?: Evidence;
  hint?: string;
}) {
  const status = evidence?.status ?? 'not_found';
  const missing = status === 'not_found' || evidence?.value === null || evidence?.value === undefined;

  return (
    <div className="grid gap-1.5 border-b border-ink-100 px-4 py-3.5 last:border-b-0 sm:grid-cols-[minmax(140px,26%)_1fr] sm:gap-4">
      <div>
        <dt className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-500">{label}</dt>
        {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
      </div>
      <dd className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[15px] ${missing ? 'italic text-ink-500' : 'font-medium text-ink-900'}`}>
            {missing ? 'Não identificado no documento.' : String(evidence?.value)}
          </span>
          <StatusChip status={status} compact />
          <SourceBadge source={evidence?.source} />
        </div>
        {evidence?.status === 'inferred' && evidence.reason ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-warn-700">
            <strong className="font-semibold">Como foi deduzido:</strong> {evidence.reason}
          </p>
        ) : null}
        {evidence?.quote ? (
          <blockquote className="mt-2 border-l-2 border-ink-200 bg-ink-50/70 px-3 py-2 text-[13px] italic leading-relaxed text-ink-600">
            “{evidence.quote}”
          </blockquote>
        ) : null}
      </dd>
    </div>
  );
}

/** Lista de itens com origem — usada em habilitação, obrigações e destaques. */
export function SourcedList({
  items,
  emptyLabel = 'Nenhuma informação identificada no documento.',
  dense = false,
}: {
  items?: SourcedItem[];
  emptyLabel?: string;
  dense?: boolean;
}) {
  if (!items || items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-4 py-3 text-sm italic text-ink-500">
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li
          key={`${item.text.slice(0, 40)}-${index}`}
          className={`print-block rounded-xl border border-ink-200 bg-white ${dense ? 'px-3.5 py-2.5' : 'px-4 py-3'}`}
        >
          <div className="flex items-start gap-3">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-400" />
            <div className="min-w-0 flex-1">
              <p className={`text-ink-800 ${dense ? 'text-[14px]' : 'text-[14.5px]'} leading-relaxed`}>{item.text}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <SourceBadge source={item.source} />
                {item.status === 'inferred' ? <StatusChip status="inferred" compact /> : null}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
