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
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.14em] text-nett-gold">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-semibold text-nett-text sm:text-[28px]">{titulo}</h1>
        {descricao ? <p className="text-pretty mt-1.5 max-w-2xl text-sm leading-relaxed text-nett-text-muted">{descricao}</p> : null}
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
    <section className={`min-w-0 rounded-2xl border border-nett-text-muted/15 bg-nett-surface shadow-soft ${className}`}>
      {titulo ? (
        <div className="flex items-center justify-between gap-3 border-b border-nett-text-muted/10 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-nett-text">{titulo}</h2>
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
    brand: 'bg-nett-gold/10 text-nett-gold',
    accent: 'bg-nett-gold-light/15 text-nett-gold',
    warn: 'bg-nett-gold-dark/30 text-nett-gold-light',
    danger: 'bg-nett-text/10 text-nett-text',
    ok: 'bg-nett-gold/20 text-nett-gold-light',
  }[tom];
  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-nett-text-muted">{rotulo}</p>
        <span className={`flex size-9 items-center justify-center rounded-xl ${cores}`}>{icone}</span>
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-nett-text">{valor}</p>
      {detalhe ? <p className="mt-1 text-xs text-nett-text-muted">{detalhe}</p> : null}
    </>
  );
  const classes = 'block rounded-2xl border border-nett-text-muted/15 bg-nett-surface p-5 shadow-soft';
  return href ? (
    <Link href={href} className={`${classes} transition hover:border-nett-gold/40 hover:shadow-lift`}>
      {conteudo}
    </Link>
  ) : (
    <div className={classes}>{conteudo}</div>
  );
}

const FAIXA_CORES: Record<Aderencia['faixa'], { anel: string; texto: string; fundo: string }> = {
  alta: { anel: '#F0D375', texto: 'text-nett-gold-light', fundo: 'bg-nett-gold/20' },
  media: { anel: '#C9A227', texto: 'text-nett-gold-light', fundo: 'bg-nett-gold-dark/30' },
  baixa: { anel: '#8A6D1A', texto: 'text-nett-text-muted', fundo: 'bg-nett-raised' },
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
        <circle cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" stroke="#111111" strokeWidth={4} />
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
    warn: 'border-nett-gold/30 bg-nett-gold-dark/15 text-nett-gold-light',
    danger: 'border-nett-text/20 bg-nett-text/4 text-nett-text',
    info: 'border-nett-gold/40 bg-nett-gold/10 text-nett-gold-light',
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
            className="inline-flex items-center gap-2 rounded-xl bg-nett-surface px-3.5 py-2 text-sm font-medium text-nett-text shadow-ring transition hover:bg-nett-text/4"
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-nett-text-muted/15 bg-nett-surface px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-nett-black text-nett-text-muted">{icone}</span>
      <p className="mt-4 font-medium text-nett-text">{titulo}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-nett-text-muted">{children}</div> : null}
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
  'inline-flex items-center justify-center gap-2 rounded-xl bg-nett-gold px-4 py-2.5 text-sm font-medium text-nett-black shadow-soft transition hover:bg-nett-gold-light disabled:cursor-not-allowed disabled:bg-nett-text-muted/15 disabled:text-nett-text-muted disabled:shadow-none';

export const botaoSecundario =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-nett-text-muted/15 bg-nett-surface px-4 py-2.5 text-sm font-medium text-nett-text transition hover:border-nett-text-muted/30 hover:bg-nett-black disabled:cursor-not-allowed disabled:opacity-60';

export const botaoFantasma =
  'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-nett-text-muted transition hover:bg-nett-raised hover:text-nett-text';
