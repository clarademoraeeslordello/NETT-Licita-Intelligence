/** Blocos visuais compartilhados pelas telas da plataforma. */
import Link from 'next/link';
import { IconAlert, IconRefresh } from '@/components/icons';
import type { Aderencia } from '@/lib/plataforma/aderencia';
import { prazoRelativo, TOM_CLASSES } from '@/lib/plataforma/formato';

export function PageHeader({
  titulo,
  descricao,
  acoes,
  eyebrow,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  acoes?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-semibold text-ink-900 sm:text-[28px]">{titulo}</h1>
        {descricao ? <p className="text-pretty mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-500">{descricao}</p> : null}
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </div>
  );
}

export function Painel({
  titulo,
  acao,
  children,
  className = '',
  semPadding = false,
}: {
  titulo?: React.ReactNode;
  acao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  semPadding?: boolean;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-ink-200 bg-white shadow-soft ${className}`}>
      {titulo ? (
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink-900">{titulo}</h2>
          {acao}
        </div>
      ) : null}
      <div className={semPadding ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

export function Kpi({
  rotulo,
  valor,
  detalhe,
  icone,
  tom = 'brand',
  href,
}: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: React.ReactNode;
  icone: React.ReactNode;
  tom?: 'brand' | 'accent' | 'warn' | 'danger' | 'ok';
  href?: string;
}) {
  const cores = {
    brand: 'bg-brand-50 text-brand-600',
    accent: 'bg-accent-400/15 text-accent-600',
    warn: 'bg-warn-100 text-warn-700',
    danger: 'bg-danger-100 text-danger-600',
    ok: 'bg-ok-100 text-ok-700',
  }[tom];
  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-500">{rotulo}</p>
        <span className={`flex size-9 items-center justify-center rounded-xl ${cores}`}>{icone}</span>
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-ink-900">{valor}</p>
      {detalhe ? <p className="mt-1 text-xs text-ink-500">{detalhe}</p> : null}
    </>
  );
  const classes = 'block rounded-2xl border border-ink-200 bg-white p-5 shadow-soft';
  return href ? (
    <Link href={href} className={`${classes} transition hover:border-brand-200 hover:shadow-lift`}>
      {conteudo}
    </Link>
  ) : (
    <div className={classes}>{conteudo}</div>
  );
}

const FAIXA_CORES: Record<Aderencia['faixa'], { anel: string; texto: string; fundo: string }> = {
  alta: { anel: '#12b76a', texto: 'text-ok-700', fundo: 'bg-ok-100' },
  media: { anel: '#f59e0b', texto: 'text-warn-700', fundo: 'bg-warn-100' },
  baixa: { anel: '#94a3b8', texto: 'text-ink-500', fundo: 'bg-ink-100' },
};

/** Anel com a nota de aderência (0–100). */
export function NotaAderencia({ aderencia, tamanho = 48 }: { aderencia: Aderencia; tamanho?: number }) {
  const cores = FAIXA_CORES[aderencia.faixa];
  const raio = tamanho / 2 - 4;
  const circ = 2 * Math.PI * raio;
  return (
    <div
      className="relative shrink-0"
      style={{ width: tamanho, height: tamanho }}
      role="img"
      aria-label={`Aderência ${aderencia.nota} de 100`}
    >
      <svg width={tamanho} height={tamanho} className="-rotate-90">
        <circle cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" stroke="#eef2f8" strokeWidth={4} />
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          fill="none"
          stroke={cores.anel}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${(aderencia.nota / 100) * circ} ${circ}`}
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold ${cores.texto}`}>
        {aderencia.nota}
      </span>
    </div>
  );
}

export function ChipPrazo({ iso, prefixo }: { iso: string | null; prefixo?: string }) {
  const prazo = prazoRelativo(iso);
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TOM_CLASSES[prazo.tom]}`}>
      {prefixo ? `${prefixo} ` : ''}
      {prazo.texto}
    </span>
  );
}

export function Aviso({
  tom = 'warn',
  titulo,
  children,
  acao,
}: {
  tom?: 'warn' | 'danger' | 'info';
  titulo: string;
  children?: React.ReactNode;
  acao?: React.ReactNode;
}) {
  const estilos = {
    warn: 'border-warn-500/30 bg-warn-100/50 text-warn-700',
    danger: 'border-danger-100 bg-danger-100/40 text-danger-700',
    info: 'border-brand-200 bg-brand-50 text-brand-800',
  }[tom];
  return (
    <div role={tom === 'danger' ? 'alert' : 'status'} className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${estilos}`}>
      <span className="shrink-0">
        <IconAlert size={20} />
      </span>
      <div className="flex-1 text-sm">
        <p className="font-medium">{titulo}</p>
        {children ? <div className="mt-0.5 opacity-90">{children}</div> : null}
      </div>
      {acao}
    </div>
  );
}

export function ErroCarregamento({ mensagem, dica, onTentar }: { mensagem: string; dica?: string; onTentar?: () => void }) {
  return (
    <Aviso
      tom="danger"
      titulo={mensagem}
      acao={
        onTentar ? (
          <button
            type="button"
            onClick={onTentar}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-danger-700 shadow-ring transition hover:bg-danger-100/40"
          >
            <IconRefresh size={16} /> Tentar novamente
          </button>
        ) : undefined
      }
    >
      {dica}
    </Aviso>
  );
}

export function Vazio({ icone, titulo, children, acao }: { icone: React.ReactNode; titulo: string; children?: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-ink-50 text-ink-400">{icone}</span>
      <p className="mt-4 font-medium text-ink-900">{titulo}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-ink-500">{children}</div> : null}
      {acao ? <div className="mt-5">{acao}</div> : null}
    </div>
  );
}

export function LinhasEsqueleto({ linhas = 5, altura = 'h-20' }: { linhas?: number; altura?: string }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: linhas }, (_, indice) => (
        <div key={indice} className={`skeleton rounded-2xl ${altura}`} />
      ))}
    </div>
  );
}

export const botaoPrimario =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-soft transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500 disabled:shadow-none';

export const botaoSecundario =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-60';

export const botaoFantasma =
  'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-800';
