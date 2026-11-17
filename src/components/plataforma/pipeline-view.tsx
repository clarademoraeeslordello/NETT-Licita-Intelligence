'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { IconAlert, IconChart, IconExternal, IconKanban, IconPlus, IconSparkles, IconTrash, IconX } from '@/components/icons';
import { brl, brlCompacto, dataHora, tituloProprio } from '@/lib/plataforma/formato';
import { useSessao } from '@/components/sessao/sessao-provider';
import { chamarApi, mensagemDeErro, useCarga } from './api-v1';
import { DecisaoParticipacaoForm } from './decisao-participacao';
import {
  ETAPAS,
  ETAPAS_ATIVAS,
  exigeParecer,
  paraDecimal,
  podeMover,
  rotuloEtapa,
  valorConquistado,
  valorEmDisputa,
  type CardApi,
  type EtapaApi,
} from './pipeline-logica';
import { botaoPrimario, botaoSecundario, ChipPrazo, ErroCarregamento, Kpi, LinhasEsqueleto, PageHeader, Vazio } from './ui';

type Listagem = { items: CardApi[]; truncated: boolean };
type Patch = Partial<{ stage: EtapaApi; proposalValue: string | null; outcome: 'won' | 'lost' | 'withdrawn' | null; notes: string; bidDecisionReviewId: string | null; discarded: boolean }>;

export function PipelineView() {
  const { empresaAtual } = useSessao();
  if (!empresaAtual) {
    return (
      <>
        <PageHeader eyebrow="Operação" titulo="Pipeline de licitações" />
        <Vazio icone={<IconKanban size={24} />} titulo="Nenhuma empresa selecionada">
          Peça a um administrador para vincular você a uma empresa cliente.
        </Vazio>
      </>
    );
  }
  return <Quadro key={empresaAtual.id} empresaId={empresaAtual.id} podeEscrever={empresaAtual.role !== 'viewer'} />;
}

function Quadro({ empresaId, podeEscrever }: { empresaId: string; podeEscrever: boolean }) {
  const { dados, setDados, erro, carregando, recarregar } = useCarga(() => chamarApi<Listagem>(`/companies/${empresaId}/pipeline`), empresaId);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<EtapaApi | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cards = useMemo(() => dados?.items ?? [], [dados]);
  const porEtapa = useMemo(() => {
    const mapa = new Map<EtapaApi, CardApi[]>(ETAPAS.map((e) => [e.id, []]));
    for (const c of cards) mapa.get(c.tracking.stage)?.push(c);
    for (const lista of mapa.values()) lista.sort((a, b) => (a.opportunity.proposalsCloseAt ?? '9').localeCompare(b.opportunity.proposalsCloseAt ?? '9'));
    return mapa;
  }, [cards]);

  const ganhas = cards.filter((c) => c.tracking.outcome === 'won');
  const perdidas = cards.filter((c) => c.tracking.outcome === 'lost');
  const ativas = cards.filter((c) => ETAPAS_ATIVAS.includes(c.tracking.stage));
  const cardAberto = cards.find((c) => c.tracking.id === aberto) ?? null;

  const substituir = (id: string, mudar: (c: CardApi) => CardApi) => setDados((d) => (d ? { ...d, items: d.items.map((c) => (c.tracking.id === id ? mudar(c) : c)) } : d));

  /** Atualiza no servidor (fonte da verdade) e só então reflete na tela. Lança em caso de erro. */
  const salvar = async (card: CardApi, patch: Patch) => {
    const r = await chamarApi<{ tracking: CardApi['tracking'] }>(`/companies/${empresaId}/pipeline/${card.tracking.id}`, { method: 'PATCH', corpo: patch });
    if (patch.discarded) setDados((d) => (d ? { ...d, items: d.items.filter((c) => c.tracking.id !== card.tracking.id) } : d));
    else substituir(card.tracking.id, (c) => ({ ...c, tracking: r.tracking }));
  };

  const mover = async (card: CardApi, destino: EtapaApi) => {
    setAviso(null);
    if (destino === card.tracking.stage) return;
    const decisao = podeMover(card, destino);
    if (!decisao.ok) {
      setAviso(decisao.motivo);
      setAberto(card.tracking.id);
      return;
    }
    try {
      await salvar(card, { stage: destino, ...(exigeParecer(destino) ? { bidDecisionReviewId: decisao.bidDecisionReviewId } : {}) });
    } catch (e) {
      setAviso(mensagemDeErro(e));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        titulo="Pipeline de licitações"
        descricao="Da triagem ao resultado: arraste os cards entre as etapas ou abra um card para registrar a decisão, a proposta, notas e o resultado. Tudo fica salvo no servidor para a equipe."
        acoes={
          podeEscrever ? (
            <button type="button" onClick={() => setAdicionando(true)} className={botaoPrimario}>
              <IconPlus size={16} /> Adicionar oportunidade
            </button>
          ) : undefined
        }
      />

      {aviso && !cardAberto ? (
        <p role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-nett-gold/30 bg-nett-gold-dark/15 px-4 py-2.5 text-sm text-nett-gold-light">
          <IconAlert size={16} /> {aviso}
        </p>
      ) : null}

      {erro ? (
        <ErroCarregamento mensagem="Não foi possível carregar o pipeline." dica={erro} onTentar={recarregar} />
      ) : carregando && !dados ? (
        <LinhasEsqueleto linhas={2} altura="h-40" />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi rotulo="Em andamento" valor={ativas.length} detalhe="licitações nas etapas ativas" icone={<IconKanban size={18} />} />
            <Kpi rotulo="Valor em disputa" valor={brlCompacto(valorEmDisputa(cards))} detalhe="proposta ou valor estimado" icone={<IconChart size={18} />} tom="accent" />
            <Kpi
              rotulo="Taxa de vitória"
              valor={ganhas.length + perdidas.length ? `${Math.round((ganhas.length / (ganhas.length + perdidas.length)) * 100)}%` : '—'}
              detalhe={`${ganhas.length} ganha(s) · ${perdidas.length} perdida(s)`}
              icone={<IconSparkles size={18} />}
              tom="ok"
            />
            <Kpi rotulo="Valor conquistado" valor={brlCompacto(valorConquistado(cards))} detalhe="soma das licitações ganhas" icone={<IconChart size={18} />} tom="warn" />
          </div>

          {dados?.truncated ? (
            <p className="mb-4 rounded-xl bg-nett-gold/10 px-4 py-2.5 text-xs text-nett-gold-light">Há mais acompanhamentos do que cabem na tela; mostrando os 100 mais recentes.</p>
          ) : null}

          {cards.length === 0 ? (
            <Vazio
              icone={<IconKanban size={24} />}
              titulo="O pipeline desta empresa está vazio"
              acao={
                podeEscrever ? (
                  <button type="button" onClick={() => setAdicionando(true)} className={botaoPrimario}>
                    <IconPlus size={16} /> Adicionar oportunidade
                  </button>
                ) : undefined
              }
            >
              Adicione editais para acompanhar cada disputa da triagem ao resultado.
            </Vazio>
          ) : (
            <div className="scrollbar-slim -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
              <div className="grid min-w-[1320px] grid-cols-6 gap-3">
                {ETAPAS.map((etapa) => {
                  const lista = porEtapa.get(etapa.id) ?? [];
                  const destacada = sobre === etapa.id && arrastando !== null;
                  return (
                    <section
                      key={etapa.id}
                      aria-label={etapa.label}
                      onDragOver={(event) => {
                        if (!podeEscrever) return;
                        event.preventDefault();
                        setSobre(etapa.id);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSobre(null);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const id = event.dataTransfer.getData('text/plain');
                        const card = cards.find((c) => c.tracking.id === id);
                        if (card && podeEscrever) void mover(card, etapa.id);
                        setSobre(null);
                        setArrastando(null);
                      }}
                      className={`flex min-h-[420px] flex-col rounded-2xl border p-2.5 transition ${destacada ? 'border-nett-gold bg-nett-gold/7' : 'border-nett-text-muted/15 bg-nett-raised/50'}`}
                    >
                      <header className="mb-2.5 px-1.5 pt-1">
                        <div className="flex items-center gap-2">
                          <span className={`size-2 rounded-full ${etapa.cor}`} />
                          <h2 className="text-sm font-semibold text-nett-text">{etapa.label}</h2>
                          <span className="ml-auto rounded-full bg-nett-surface px-2 py-0.5 font-mono text-[11px] text-nett-text-muted shadow-ring">{lista.length}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-nett-text-muted">{etapa.descricao}</p>
                      </header>
                      <div className="flex flex-1 flex-col gap-2">
                        {lista.map((card) => (
                          <CardKanban
                            key={card.tracking.id}
                            card={card}
                            arrastavel={podeEscrever}
                            arrastando={arrastando === card.tracking.id}
                            onDragStart={() => setArrastando(card.tracking.id)}
                            onDragEnd={() => {
                              setArrastando(null);
                              setSobre(null);
                            }}
                            onAbrir={() => {
                              setAviso(null);
                              setAberto(card.tracking.id);
                            }}
                          />
                        ))}
                        {lista.length === 0 ? <p className="rounded-xl border border-dashed border-nett-text-muted/21 px-3 py-6 text-center text-xs text-nett-text-muted">Nenhum card nesta etapa</p> : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {cardAberto ? (
        <DetalheCard
          key={cardAberto.tracking.id}
          card={cardAberto}
          empresaId={empresaId}
          podeEscrever={podeEscrever}
          aviso={aviso}
          onFechar={() => {
            setAberto(null);
            setAviso(null);
          }}
          onMover={(destino) => mover(cardAberto, destino)}
          onSalvar={(patch) => salvar(cardAberto, patch)}
          onParecer={(p) => substituir(cardAberto.tracking.id, (c) => ({ ...c, latestBidDecision: p }))}
        />
      ) : null}

      {adicionando ? (
        <AdicionarOportunidade
          empresaId={empresaId}
          jaNoPipeline={new Set(cards.map((c) => c.opportunity.id))}
          onFechar={() => setAdicionando(false)}
          onAdicionada={() => {
            setAdicionando(false);
            void recarregar();
          }}
        />
      ) : null}
    </>
  );
}

function CardKanban({
  card,
  arrastavel,
  arrastando,
  onDragStart,
  onDragEnd,
  onAbrir,
}: {
  card: CardApi;
  arrastavel: boolean;
  arrastando: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onAbrir: () => void;
}) {
  const op = card.opportunity;
  const valor = card.tracking.proposalValue ?? op.estimatedValue;
  const resultado = card.tracking.outcome;
  return (
    <button
      type="button"
      draggable={arrastavel}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', card.tracking.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onAbrir}
      className={`w-full rounded-xl border border-nett-text-muted/15 bg-nett-surface p-3 text-left shadow-soft transition hover:border-nett-gold/40 hover:shadow-lift ${arrastavel ? 'cursor-grab active:cursor-grabbing' : ''} ${arrastando ? 'rotate-1 opacity-50' : ''}`}
    >
      <p className="truncate text-[11px] font-medium text-nett-text-muted">
        {tituloProprio(op.agencyName)}
        {op.uf ? ` · ${op.uf}` : ''}
      </p>
      <p className="mt-1 line-clamp-3 text-[13px] font-medium leading-snug text-nett-text">{op.title}</p>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5">
        <span className="font-mono text-xs font-semibold text-nett-text">{valor ? brlCompacto(Number(valor)) : '—'}</span>
        {card.tracking.stage === 'result' ? (
          resultado ? (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${resultado === 'won' ? 'bg-nett-gold/20 text-nett-gold-light' : 'bg-nett-text/10 text-nett-text'}`}>
              {resultado === 'won' ? 'Ganha' : resultado === 'lost' ? 'Perdida' : 'Desistência'}
            </span>
          ) : (
            <span className="text-[11px] text-nett-text-muted">sem resultado</span>
          )
        ) : (
          <ChipPrazo iso={op.proposalsCloseAt} />
        )}
      </div>
    </button>
  );
}

function DetalheCard({
  card,
  empresaId,
  podeEscrever,
  aviso,
  onFechar,
  onMover,
  onSalvar,
  onParecer,
}: {
  card: CardApi;
  empresaId: string;
  podeEscrever: boolean;
  aviso: string | null;
  onFechar: () => void;
  onMover: (destino: EtapaApi) => Promise<void>;
  onSalvar: (patch: Patch) => Promise<void>;
  onParecer: (p: NonNullable<CardApi['latestBidDecision']>) => void;
}) {
  const op = card.opportunity;
  const t = card.tracking;
  const [notas, setNotas] = useState(t.notes);
  const [proposta, setProposta] = useState(t.proposalValue ? Number(t.proposalValue).toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : '');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onFechar();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onFechar]);

  const tentar = async (acao: () => Promise<void>) => {
    setErro(null);
    try {
      await acao();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  const salvarProposta = () =>
    tentar(async () => {
      const valor = proposta.trim() ? paraDecimal(proposta) : null;
      if (proposta.trim() && valor === null) throw new Error('Valor inválido. Use, por exemplo, 185.000,00.');
      if ((valor === null ? null : Number(valor)) === (t.proposalValue === null ? null : Number(t.proposalValue))) return;
      await onSalvar({ proposalValue: valor });
    });

  const mensagem = erro ?? aviso;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="detalhe-card-titulo">
      <button type="button" className="absolute inset-0 bg-nett-black/40" aria-label="Fechar" onClick={onFechar} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-lg animate-[fade-in_0.2s_ease-out_both] flex-col bg-nett-surface shadow-lift">
        <div className="flex items-start gap-3 border-b border-nett-text-muted/10 p-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-nett-text-muted">
              {tituloProprio(op.agencyName)}
              {op.uf ? ` · ${op.uf}` : ''}
            </p>
            <h2 id="detalhe-card-titulo" className="mt-1 text-base font-semibold leading-snug text-nett-text">
              {op.title}
            </h2>
          </div>
          <button type="button" onClick={onFechar} className="rounded-lg p-1.5 text-nett-text-muted hover:bg-nett-raised hover:text-nett-text" aria-label="Fechar">
            <IconX size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {mensagem ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-nett-gold/30 bg-nett-gold-dark/15 px-3 py-2.5 text-sm text-nett-gold-light">
              <IconAlert size={16} /> <span>{mensagem}</span>
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-nett-text-muted">Valor estimado</dt>
              <dd className="mt-0.5 font-mono font-semibold">{op.estimatedValue ? brl(Number(op.estimatedValue)) : 'Não informado'}</dd>
            </div>
            <div>
              <dt className="text-xs text-nett-text-muted">Propostas até</dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">{dataHora(op.proposalsCloseAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-nett-text-muted">Modalidade</dt>
              <dd className="mt-0.5">{op.modalityName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-nett-text-muted">Prazo</dt>
              <dd className="mt-0.5">
                <ChipPrazo iso={op.proposalsCloseAt} />
              </dd>
            </div>
          </dl>

          <DecisaoParticipacaoForm companyId={empresaId} opportunityId={op.id} atual={card.latestBidDecision} podeEscrever={podeEscrever} onRegistrado={onParecer} />

          <label className="block">
            <span className="text-xs font-medium text-nett-text">Etapa</span>
            <select
              value={t.stage}
              disabled={!podeEscrever}
              onChange={(event) => void tentar(() => onMover(event.target.value as EtapaApi))}
              className="mt-1 w-full rounded-xl border border-nett-text-muted/15 bg-nett-surface px-3 py-2.5 text-sm"
            >
              {ETAPAS.map((etapa) => (
                <option key={etapa.id} value={etapa.id}>
                  {etapa.label}
                  {etapa.exigeParecer ? ' (exige parecer aprovado)' : ''}
                </option>
              ))}
            </select>
          </label>

          {t.stage === 'result' ? (
            <div>
              <span className="text-xs font-medium text-nett-text">Resultado</span>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {(
                  [
                    ['won', 'Ganhamos'],
                    ['lost', 'Perdemos'],
                    ['withdrawn', 'Desistimos'],
                  ] as const
                ).map(([valor, rotulo]) => (
                  <button
                    key={valor}
                    type="button"
                    disabled={!podeEscrever}
                    aria-pressed={t.outcome === valor}
                    onClick={() => void tentar(() => onSalvar({ outcome: t.outcome === valor ? null : valor }))}
                    className={`rounded-xl border px-2 py-2.5 text-sm font-medium transition disabled:opacity-60 ${
                      t.outcome === valor ? 'border-nett-gold bg-nett-gold/20 text-nett-gold-light' : 'border-nett-text-muted/15 text-nett-text hover:bg-nett-black'
                    }`}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="block">
            <span className="text-xs font-medium text-nett-text">Valor da nossa proposta (R$)</span>
            <input
              inputMode="decimal"
              value={proposta}
              disabled={!podeEscrever}
              onChange={(event) => setProposta(event.target.value)}
              onBlur={() => void salvarProposta()}
              placeholder="Ex.: 185.000,00"
              className="mt-1 w-full rounded-xl border border-nett-text-muted/15 px-3 py-2.5 font-mono text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-nett-text">Notas da equipe</span>
            <textarea
              value={notas}
              disabled={!podeEscrever}
              maxLength={5000}
              onChange={(event) => setNotas(event.target.value)}
              onBlur={() => notas !== t.notes && void tentar(() => onSalvar({ notes: notas }))}
              rows={5}
              placeholder="Exigências críticas, dúvidas para esclarecimento, responsáveis…"
              className="mt-1 w-full resize-y rounded-xl border border-nett-text-muted/15 px-3 py-2.5 text-sm"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            {card.latestAnalysis ? (
              <Link href={`/revisao/${card.latestAnalysis.id}`} className={botaoPrimario}>
                <IconSparkles size={16} /> Revisar análise
              </Link>
            ) : (
              <span className="rounded-xl border border-dashed border-nett-text-muted/21 px-3 py-2.5 text-center text-xs text-nett-text-muted">Sem análise concluída para revisar</span>
            )}
            <a href={op.url} target="_blank" rel="noreferrer" className={botaoSecundario}>
              <IconExternal size={15} /> Abrir no portal de origem
            </a>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-nett-text-muted/10 p-4">
          <p className="text-xs text-nett-text-muted">
            Etapa: {rotuloEtapa(t.stage)} · atualizado em {dataHora(t.updatedAt)}
          </p>
          {podeEscrever ? (
            <button
              type="button"
              onClick={() =>
                void tentar(async () => {
                  await onSalvar({ discarded: true });
                  onFechar();
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-nett-text hover:bg-nett-text/5"
            >
              <IconTrash size={15} /> Descartar
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type Achada = { id: string; title: string; agencyName: string; uf: string | null; proposalsCloseAt: string | null };

function AdicionarOportunidade({ empresaId, jaNoPipeline, onFechar, onAdicionada }: { empresaId: string; jaNoPipeline: Set<string>; onFechar: () => void; onAdicionada: () => void }) {
  const [q, setQ] = useState('');
  const [achadas, setAchadas] = useState<Achada[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onFechar();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onFechar]);

  const buscar = async () => {
    if (q.trim().length < 3) {
      setErro('Digite ao menos 3 caracteres.');
      return;
    }
    setBuscando(true);
    setErro(null);
    try {
      const r = await chamarApi<{ items: Achada[] }>(`/opportunities?q=${encodeURIComponent(q.trim())}&limit=10`);
      setAchadas(r.items);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setBuscando(false);
    }
  };

  const adicionar = async (id: string) => {
    setErro(null);
    try {
      await chamarApi(`/companies/${empresaId}/pipeline`, { method: 'POST', corpo: { opportunityId: id } });
      onAdicionada();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="add-op-titulo">
      <button type="button" className="absolute inset-0 bg-nett-black/40" aria-label="Fechar" onClick={onFechar} />
      <div className="relative max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-nett-surface p-6 shadow-lift sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="add-op-titulo" className="text-lg font-semibold text-nett-text">
            Adicionar oportunidade
          </h2>
          <button type="button" onClick={onFechar} className="rounded-lg p-1.5 text-nett-text-muted hover:bg-nett-raised" aria-label="Fechar">
            <IconX size={20} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void buscar();
          }}
          className="flex gap-2"
        >
          <label className="flex-1">
            <span className="sr-only">Buscar por objeto, órgão ou município</span>
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Objeto, órgão ou município" className="w-full rounded-xl border border-nett-text-muted/15 px-3 py-2.5 text-sm" autoFocus />
          </label>
          <button type="submit" disabled={buscando} className={botaoPrimario}>
            {buscando ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        {erro ? (
          <p role="alert" className="mt-3 flex items-center gap-1.5 text-sm text-nett-gold-light">
            <IconAlert size={15} /> {erro}
          </p>
        ) : null}
        {achadas ? (
          achadas.length === 0 ? (
            <p className="mt-4 text-sm text-nett-text-muted">Nada encontrado. Tente outros termos.</p>
          ) : (
            <ul className="mt-4 divide-y divide-nett-text-muted/10">
              {achadas.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium text-nett-text">{o.title}</p>
                    <p className="mt-0.5 text-xs text-nett-text-muted">
                      {tituloProprio(o.agencyName)}
                      {o.uf ? ` · ${o.uf}` : ''}
                    </p>
                  </div>
                  {jaNoPipeline.has(o.id) ? (
                    <span className="text-xs text-nett-text-muted">no pipeline</span>
                  ) : (
                    <button type="button" onClick={() => void adicionar(o.id)} className={botaoSecundario}>
                      Adicionar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
