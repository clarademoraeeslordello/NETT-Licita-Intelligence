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
  if (item.valorEstimado === null) return <span className="text-nett-text-muted">valor não informado</span>;
  return <span className="font-mono font-semibold text-nett-text">{brlCompacto(item.valorEstimado)}</span>;
}

export function DecomposicaoNota({ item }: { item: ItemRadar }) {
  return (
    <div className="space-y-2.5">
      {item.aderencia.fatores.map((fator) => (
        <div key={fator.id} className="grid grid-cols-[88px_1fr_44px] items-center gap-3 text-xs">
          <span className="font-medium text-nett-text">{fator.label}</span>
          <div className="min-w-0">
            <div className="h-1.5 overflow-hidden rounded-full bg-nett-raised">
              <div
                className="h-full rounded-full bg-nett-gold"
                style={{ width: `${Math.round((fator.pontos / fator.max) * 100)}%` }}
              />
            </div>
            <p className="mt-1 truncate text-nett-text-muted" title={fator.detalhe}>
              {fator.detalhe}
            </p>
          </div>
          <span className="text-right font-mono text-nett-text">
            {Math.round(fator.pontos)}/{fator.max}
          </span>
        </div>
      ))}
      {item.aderencia.bloqueio ? <p className="text-xs font-medium text-nett-text">{item.aderencia.bloqueio}</p> : null}
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
    <article className="group rounded-2xl border border-nett-text-muted/15 bg-nett-surface p-4 shadow-soft transition hover:border-nett-gold/40 hover:shadow-lift sm:p-5">
      <div className="flex gap-4">
        <NotaAderencia aderencia={item.aderencia} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-nett-text-muted">
            <span className="font-medium text-nett-text">{tituloProprio(item.orgao)}</span>
            <span className="inline-flex items-center gap-1">
              <IconMapPin size={12} />
              {item.municipio ? `${tituloProprio(item.municipio)}/` : ''}
              {item.uf}
            </span>
            <span className="text-nett-text-muted">·</span>
            <span>{item.modalidade}</span>
          </div>

          <Link href={rotaOportunidade(item)} className="mt-1.5 block">
            <h3 className="line-clamp-2 text-[15px] font-medium leading-snug text-nett-text transition group-hover:text-nett-gold-light">
              {item.objeto || item.titulo}
            </h3>
          </Link>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <ValorEstimado item={item} />
            <span className="text-nett-text-muted">·</span>
            <ChipPrazo iso={item.encerramentoPropostas} prefixo="propostas até" />
            {item.aderencia.termosEncontrados.slice(0, 3).map((termo) => (
              <span key={termo} className="rounded-full bg-nett-gold/10 px-2 py-0.5 text-xs font-medium text-nett-gold-light">
                {termo}
              </span>
            ))}
          </div>

          <details className="mt-3 group/nota">
            <summary className="w-fit cursor-pointer list-none text-xs font-medium text-nett-text-muted transition hover:text-nett-gold-light [&::-webkit-details-marker]:hidden">
              Por que {item.aderencia.nota}?{' '}
              <span className="inline-block transition group-open/nota:rotate-180">▾</span>
            </summary>
            <div className="mt-3 max-w-lg rounded-xl bg-nett-black p-3">
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
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-nett-text-muted transition hover:bg-nett-raised hover:text-nett-text"
            >
              <IconX size={13} /> Descartar
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-nett-text-muted/10 pt-3 sm:hidden">
        <BotaoPipeline noPipeline={noPipeline} onAdicionar={onAdicionar} />
        {onDescartar ? (
          <button type="button" onClick={onDescartar} className="rounded-lg px-3 py-2 text-xs text-nett-text-muted hover:bg-nett-raised">
            Descartar
          </button>
        ) : null}
        <Link href={rotaOportunidade(item)} className="ml-auto text-xs font-medium text-nett-gold-light">
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
        className="inline-flex items-center gap-1.5 rounded-xl bg-nett-gold/20 px-3 py-2 text-xs font-semibold text-nett-gold-light transition hover:bg-nett-gold/14"
      >
        <IconCheck size={14} /> No pipeline
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdicionar}
      className="inline-flex items-center gap-1.5 rounded-xl bg-nett-raised px-3 py-2 text-xs font-semibold text-nett-text transition hover:bg-nett-gold-light hover:text-nett-black"
    >
      <IconPlus size={14} /> Pipeline
    </button>
  );
}
