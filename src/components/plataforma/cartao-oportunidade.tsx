'use client';

import Link from 'next/link';
import { IconCheck, IconMapPin, IconPlus, IconX } from '@/components/icons';
import type { ItemRadar } from './use-radar';
import { brlCompacto, tituloProprio } from '@/lib/plataforma/formato';
import { ChipPrazo, NotaAderencia } from './ui';

export const rotaOportunidade = (op: { cnpj: string; ano: string; sequencial: string }) =>
  `/radar/${op.cnpj}/${op.ano}/${op.sequencial}`;

export function ValorEstimado({ item }: { item: Pick<ItemRadar, 'valorEstimado' | 'valorStatus'> }) {
  if (item.valorStatus === 'carregando') {
    return <span className="skeleton inline-block h-4 w-20 rounded-md align-middle" aria-label="Consultando valor" />;
  }
  if (item.valorEstimado === null) return <span className="text-ink-400">valor não informado</span>;
  return <span className="font-mono font-semibold text-ink-900">{brlCompacto(item.valorEstimado)}</span>;
}

export function DecomposicaoNota({ item }: { item: ItemRadar }) {
  return (
    <div className="space-y-2.5">
      {item.aderencia.fatores.map((fator) => (
        <div key={fator.id} className="grid grid-cols-[88px_1fr_44px] items-center gap-3 text-xs">
          <span className="font-medium text-ink-600">{fator.label}</span>
          <div className="min-w-0">
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${Math.round((fator.pontos / fator.max) * 100)}%` }}
              />
            </div>
            <p className="mt-1 truncate text-ink-500" title={fator.detalhe}>
              {fator.detalhe}
            </p>
          </div>
          <span className="text-right font-mono text-ink-700">
            {Math.round(fator.pontos)}/{fator.max}
          </span>
        </div>
      ))}
      {item.aderencia.bloqueio ? <p className="text-xs font-medium text-danger-700">{item.aderencia.bloqueio}</p> : null}
    </div>
  );
}

export function CartaoOportunidade({
  item,
  noPipeline,
  onAdicionar,
  onDescartar,
}: {
  item: ItemRadar;
  noPipeline: boolean;
  onAdicionar: () => void;
  onDescartar?: () => void;
}) {
  return (
    <article className="group rounded-2xl border border-ink-200 bg-white p-4 shadow-soft transition hover:border-brand-200 hover:shadow-lift sm:p-5">
      <div className="flex gap-4">
        <NotaAderencia aderencia={item.aderencia} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            <span className="font-medium text-ink-700">{tituloProprio(item.orgao)}</span>
            <span className="inline-flex items-center gap-1">
              <IconMapPin size={12} />
              {item.municipio ? `${tituloProprio(item.municipio)}/` : ''}
              {item.uf}
            </span>
            <span className="text-ink-300">·</span>
            <span>{item.modalidade}</span>
          </div>

          <Link href={rotaOportunidade(item)} className="mt-1.5 block">
            <h3 className="line-clamp-2 text-[15px] font-medium leading-snug text-ink-900 transition group-hover:text-brand-700">
              {item.objeto || item.titulo}
            </h3>
          </Link>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <ValorEstimado item={item} />
            <span className="text-ink-300">·</span>
            <ChipPrazo iso={item.encerramentoPropostas} prefixo="propostas até" />
            {item.aderencia.termosEncontrados.slice(0, 3).map((termo) => (
              <span key={termo} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                {termo}
              </span>
            ))}
          </div>

          <details className="mt-3 group/nota">
            <summary className="w-fit cursor-pointer list-none text-xs font-medium text-ink-500 transition hover:text-brand-700 [&::-webkit-details-marker]:hidden">
              Por que {item.aderencia.nota}?{' '}
              <span className="inline-block transition group-open/nota:rotate-180">▾</span>
            </summary>
            <div className="mt-3 max-w-lg rounded-xl bg-ink-50 p-3">
              <DecomposicaoNota item={item} />
            </div>
          </details>
        </div>

        <div className="hidden shrink-0 flex-col items-end gap-2 sm:flex">
          <BotaoPipeline noPipeline={noPipeline} onAdicionar={onAdicionar} />
          {onDescartar ? (
            <button
              type="button"
              onClick={onDescartar}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
            >
              <IconX size={13} /> Descartar
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-ink-100 pt-3 sm:hidden">
        <BotaoPipeline noPipeline={noPipeline} onAdicionar={onAdicionar} />
        {onDescartar ? (
          <button type="button" onClick={onDescartar} className="rounded-lg px-3 py-2 text-xs text-ink-500 hover:bg-ink-100">
            Descartar
          </button>
        ) : null}
        <Link href={rotaOportunidade(item)} className="ml-auto text-xs font-medium text-brand-700">
          Detalhes →
        </Link>
      </div>
    </article>
  );
}

export function BotaoPipeline({ noPipeline, onAdicionar }: { noPipeline: boolean; onAdicionar: () => void }) {
  if (noPipeline) {
    return (
      <Link
        href="/pipeline"
        className="inline-flex items-center gap-1.5 rounded-xl bg-ok-100 px-3 py-2 text-xs font-semibold text-ok-700 transition hover:bg-ok-100/70"
      >
        <IconCheck size={14} /> No pipeline
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdicionar}
      className="inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
    >
      <IconPlus size={14} /> Pipeline
    </button>
  );
}
