'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { IconChart, IconExternal, IconKanban, IconRadar, IconSparkles, IconTrash, IconX } from '@/components/icons';
import { brl, brlCompacto, dataHora, tituloProprio } from '@/lib/plataforma/formato';
import { palavrasChave } from '@/lib/plataforma/texto';
import { ETAPAS, ETAPAS_ATIVAS, valorEmDisputa, type CardPipeline, type EtapaId } from '@/lib/plataforma/workspace';
import { rotaOportunidade } from './cartao-oportunidade';
import { useWorkspace } from './workspace-provider';
import { botaoPrimario, botaoSecundario, ChipPrazo, Kpi, LinhasEsqueleto, PageHeader, Vazio } from './ui';

export function PipelineView() {
  const { ws, pronto, moverCard, limparExemplos } = useWorkspace();
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<EtapaId | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  const porEtapa = useMemo(() => {
    const mapa = new Map<EtapaId, CardPipeline[]>(ETAPAS.map((etapa) => [etapa.id, []]));
    for (const card of ws.pipeline) mapa.get(card.etapa)?.push(card);
    for (const lista of mapa.values()) {
      lista.sort((a, b) => (a.oportunidade.encerramentoPropostas ?? '9').localeCompare(b.oportunidade.encerramentoPropostas ?? '9'));
    }
    return mapa;
  }, [ws.pipeline]);

  const ganhas = ws.pipeline.filter((card) => card.resultado === 'ganha');
  const perdidas = ws.pipeline.filter((card) => card.resultado === 'perdida');
  const ativas = ws.pipeline.filter((card) => ETAPAS_ATIVAS.includes(card.etapa));
  const temExemplos = ws.pipeline.some((card) => card.exemplo);
  const cardAberto = ws.pipeline.find((card) => card.id === aberto) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        titulo="Pipeline de licitações"
        descricao="Da triagem ao resultado: arraste os cards entre as etapas ou abra um card para registrar proposta, notas e resultado."
        acoes={
          <>
            {temExemplos ? (
              <button type="button" onClick={limparExemplos} className={botaoSecundario}>
                <IconTrash size={16} /> Remover exemplos
              </button>
            ) : null}
            <Link href="/radar" className={botaoPrimario}>
              <IconRadar size={16} /> Buscar no radar
            </Link>
          </>
        }
      />

      {!pronto ? (
        <LinhasEsqueleto linhas={2} altura="h-40" />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi rotulo="Em andamento" valor={ativas.length} detalhe="licitações nas etapas ativas" icone={<IconKanban size={18} />} />
            <Kpi rotulo="Valor em disputa" valor={brlCompacto(valorEmDisputa(ws.pipeline))} detalhe="proposta ou valor estimado" icone={<IconChart size={18} />} tom="accent" />
            <Kpi
              rotulo="Taxa de vitória"
              valor={ganhas.length + perdidas.length ? `${Math.round((ganhas.length / (ganhas.length + perdidas.length)) * 100)}%` : '—'}
              detalhe={`${ganhas.length} ganha(s) · ${perdidas.length} perdida(s)`}
              icone={<IconSparkles size={18} />}
              tom="ok"
            />
            <Kpi
              rotulo="Valor conquistado"
              valor={brlCompacto(ganhas.reduce((total, card) => total + (card.valorProposta ?? card.oportunidade.valorEstimado ?? 0), 0))}
              detalhe="soma das licitações ganhas"
              icone={<IconChart size={18} />}
              tom="warn"
            />
          </div>

          {temExemplos ? (
            <p className="mb-4 rounded-xl bg-brand-50 px-4 py-2.5 text-xs text-brand-800">
              Os cards marcados como <strong>exemplo</strong> são editais reais do PNCP colocados aqui para demonstração.
              Remova-os quando começar a usar o seu pipeline.
            </p>
          ) : null}

          {ws.pipeline.length === 0 ? (
            <Vazio
              icone={<IconKanban size={24} />}
              titulo="Seu pipeline está vazio"
              acao={
                <Link href="/radar" className={botaoPrimario}>
                  <IconRadar size={16} /> Encontrar oportunidades
                </Link>
              }
            >
              Adicione editais pelo Radar para acompanhar cada disputa da triagem ao resultado.
            </Vazio>
          ) : (
            <div className="scrollbar-slim -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
              <div className="grid min-w-[1320px] grid-cols-6 gap-3">
                {ETAPAS.map((etapa) => {
                  const cards = porEtapa.get(etapa.id) ?? [];
                  const destacada = sobre === etapa.id && arrastando !== null;
                  return (
                    <section
                      key={etapa.id}
                      aria-label={etapa.label}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setSobre(etapa.id);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSobre(null);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const id = event.dataTransfer.getData('text/plain');
                        if (id) moverCard(id, etapa.id);
                        setSobre(null);
                        setArrastando(null);
                      }}
                      className={`flex min-h-[420px] flex-col rounded-2xl border p-2.5 transition ${
                        destacada ? 'border-brand-300 bg-brand-50/70' : 'border-ink-200 bg-ink-100/50'
                      }`}
                    >
                      <header className="mb-2.5 px-1.5 pt-1">
                        <div className="flex items-center gap-2">
                          <span className={`size-2 rounded-full ${etapa.cor}`} />
                          <h2 className="text-sm font-semibold text-ink-800">{etapa.label}</h2>
                          <span className="ml-auto rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-ink-500 shadow-ring">
                            {cards.length}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-ink-500">{etapa.descricao}</p>
                      </header>

                      <div className="flex flex-1 flex-col gap-2">
                        {cards.map((card) => (
                          <CardKanban
                            key={card.id}
                            card={card}
                            arrastando={arrastando === card.id}
                            onDragStart={() => setArrastando(card.id)}
                            onDragEnd={() => {
                              setArrastando(null);
                              setSobre(null);
                            }}
                            onAbrir={() => setAberto(card.id)}
                          />
                        ))}
                        {cards.length === 0 ? (
                          <p className="rounded-xl border border-dashed border-ink-300/70 px-3 py-6 text-center text-xs text-ink-400">
                            Arraste um card para cá
                          </p>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {cardAberto ? <DetalheCard card={cardAberto} onFechar={() => setAberto(null)} /> : null}
    </>
  );
}

function CardKanban({
  card,
  arrastando,
  onDragStart,
  onDragEnd,
  onAbrir,
}: {
  card: CardPipeline;
  arrastando: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onAbrir: () => void;
}) {
  const op = card.oportunidade;
  const valor = card.valorProposta ?? op.valorEstimado;
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', card.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onAbrir}
      className={`w-full cursor-grab rounded-xl border border-ink-200 bg-white p-3 text-left shadow-soft transition hover:border-brand-200 hover:shadow-lift active:cursor-grabbing ${
        arrastando ? 'rotate-1 opacity-50' : ''
      }`}
    >
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-500">
          {tituloProprio(op.orgao)} · {op.uf}
        </p>
        {card.exemplo ? <span className="rounded bg-ink-100 px-1.5 py-px text-[10px] font-semibold uppercase text-ink-500">exemplo</span> : null}
      </div>
      <p className="mt-1 line-clamp-3 text-[13px] font-medium leading-snug text-ink-900">{op.objeto}</p>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5">
        <span className="font-mono text-xs font-semibold text-ink-800">{brlCompacto(valor)}</span>
        {card.etapa === 'resultado' ? (
          card.resultado ? (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                card.resultado === 'ganha' ? 'bg-ok-100 text-ok-700' : 'bg-danger-100 text-danger-700'
              }`}
            >
              {card.resultado === 'ganha' ? 'Ganha' : 'Perdida'}
            </span>
          ) : (
            <span className="text-[11px] text-ink-500">sem resultado</span>
          )
        ) : (
          <ChipPrazo iso={op.encerramentoPropostas} />
        )}
      </div>
    </button>
  );
}

function DetalheCard({ card, onFechar }: { card: CardPipeline; onFechar: () => void }) {
  const { moverCard, atualizarCard, removerDoPipeline } = useWorkspace();
  const op = card.oportunidade;
  const [notas, setNotas] = useState(card.notas);
  const [proposta, setProposta] = useState(card.valorProposta?.toString() ?? '');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onFechar();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onFechar]);

  const salvarProposta = () => {
    const numero = Number(proposta.replace(/\./g, '').replace(',', '.'));
    atualizarCard(card.id, { valorProposta: proposta.trim() && Number.isFinite(numero) && numero > 0 ? numero : null });
  };

  const termo = palavrasChave(op.objeto).slice(0, 2).join(' ');

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="detalhe-card-titulo">
      <button type="button" className="absolute inset-0 bg-ink-950/40" aria-label="Fechar" onClick={onFechar} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-lg animate-[fade-in_0.2s_ease-out_both] flex-col bg-white shadow-lift">
        <div className="flex items-start gap-3 border-b border-ink-100 p-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-500">
              {tituloProprio(op.orgao)} · {op.municipio ? `${tituloProprio(op.municipio)}/` : ''}
              {op.uf}
            </p>
            <h2 id="detalhe-card-titulo" className="mt-1 text-base font-semibold leading-snug text-ink-900">
              {op.objeto}
            </h2>
          </div>
          <button type="button" onClick={onFechar} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Fechar">
            <IconX size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-ink-500">Valor estimado</dt>
              <dd className="mt-0.5 font-mono font-semibold">{brl(op.valorEstimado)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">Propostas até</dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {dataHora(op.encerramentoPropostas)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">Modalidade</dt>
              <dd className="mt-0.5">{op.modalidade}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">Prazo</dt>
              <dd className="mt-0.5">
                <ChipPrazo iso={op.encerramentoPropostas} />
              </dd>
            </div>
          </dl>

          <label className="block">
            <span className="text-xs font-medium text-ink-600">Etapa</span>
            <select
              value={card.etapa}
              onChange={(event) => moverCard(card.id, event.target.value as EtapaId)}
              className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm"
            >
              {ETAPAS.map((etapa) => (
                <option key={etapa.id} value={etapa.id}>
                  {etapa.label}
                </option>
              ))}
            </select>
          </label>

          {card.etapa === 'resultado' ? (
            <div>
              <span className="text-xs font-medium text-ink-600">Resultado</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(['ganha', 'perdida'] as const).map((resultado) => (
                  <button
                    key={resultado}
                    type="button"
                    aria-pressed={card.resultado === resultado}
                    onClick={() => atualizarCard(card.id, { resultado: card.resultado === resultado ? null : resultado })}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      card.resultado === resultado
                        ? resultado === 'ganha'
                          ? 'border-ok-500 bg-ok-100 text-ok-700'
                          : 'border-danger-500 bg-danger-100 text-danger-700'
                        : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                    }`}
                  >
                    {resultado === 'ganha' ? 'Ganhamos' : 'Perdemos'}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="block">
            <span className="text-xs font-medium text-ink-600">Valor da nossa proposta (R$)</span>
            <input
              inputMode="decimal"
              value={proposta}
              onChange={(event) => setProposta(event.target.value)}
              onBlur={salvarProposta}
              placeholder="Ex.: 185000"
              className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 font-mono text-sm"
            />
            {op.valorEstimado && card.valorProposta ? (
              <span className="mt-1 block text-xs text-ink-500">
                {(((op.valorEstimado - card.valorProposta) / op.valorEstimado) * 100).toFixed(1).replace('.', ',')}% abaixo do estimado
              </span>
            ) : null}
          </label>

          <label className="block">
            <span className="text-xs font-medium text-ink-600">Notas da equipe</span>
            <textarea
              value={notas}
              onChange={(event) => setNotas(event.target.value)}
              onBlur={() => atualizarCard(card.id, { notas })}
              rows={5}
              placeholder="Exigências críticas, dúvidas para esclarecimento, responsáveis…"
              className="mt-1 w-full resize-y rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <Link href={`/analisador?pncp=${op.cnpj}/${op.ano}/${op.sequencial}`} className={botaoPrimario}>
              <IconSparkles size={16} /> Analisar edital
            </Link>
            <Link href={`/precos?q=${encodeURIComponent(termo)}`} className={botaoSecundario}>
              <IconChart size={16} /> Preços similares
            </Link>
            <Link href={rotaOportunidade(op)} className={botaoSecundario}>
              Ver oportunidade
            </Link>
            <a href={op.linkPncp} target="_blank" rel="noreferrer" className={botaoSecundario}>
              <IconExternal size={15} /> Abrir no PNCP
            </a>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-ink-100 p-4">
          <p className="text-xs text-ink-500">Atualizado em {dataHora(card.atualizadoEm)}</p>
          <button
            type="button"
            onClick={() => {
              removerDoPipeline(card.id);
              onFechar();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-danger-700 hover:bg-danger-100/50"
          >
            <IconTrash size={15} /> Remover
          </button>
        </div>
      </div>
    </div>
  );
}
