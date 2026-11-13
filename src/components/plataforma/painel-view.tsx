'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import {
  IconAlert,
  IconArrowRight,
  IconChart,
  IconClock,
  IconFolder,
  IconKanban,
  IconRadar,
  IconSparkles,
  IconTarget,
} from '@/components/icons';
import { eventosAgenda, eventosFuturos } from '@/lib/plataforma/agenda';
import { brlCompacto, prazoRelativo, tituloProprio } from '@/lib/plataforma/formato';
import {
  ETAPAS,
  ETAPAS_ATIVAS,
  prontidaoDocumental,
  situacaoDocumento,
  valorEmDisputa,
} from '@/lib/plataforma/workspace';
import { ListaEventos } from './agenda-view';
import { rotaOportunidade, ValorEstimado } from './cartao-oportunidade';
import { useRadar } from './use-radar';
import { useWorkspace } from './workspace-provider';
import { ChipPrazo, Kpi, NotaAderencia, Painel } from './ui';

type Alerta = { id: string; tom: 'danger' | 'warn'; titulo: string; detalhe: string; href: string };

function saudacao(): string {
  const hora = Number(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).slice(0, 2));
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
}

export function PainelView() {
  const { ws, pronto, escolherInicio } = useWorkspace();
  const { estado, itens } = useRadar();
  const router = useRouter();

  const ativos = ws.pipeline.filter((card) => ETAPAS_ATIVAS.includes(card.etapa));
  const altas = itens.filter((item) => item.aderencia.faixa === 'alta' && !ws.descartadas.includes(item.id));
  const melhores = itens.filter((item) => !ws.descartadas.includes(item.id)).slice(0, 5);
  const proximoPrazo = ativos
    .map((card) => card.oportunidade.encerramentoPropostas)
    .filter((iso): iso is string => Boolean(iso) && new Date(iso as string).getTime() > Date.now())
    .sort()[0];

  const alertas = useMemo<Alerta[]>(() => {
    if (!pronto) return [];
    const lista: Alerta[] = [];
    for (const doc of ws.documentos) {
      const { situacao, dias } = situacaoDocumento(doc);
      if (situacao === 'vencido') {
        lista.push({ id: doc.id, tom: 'danger', titulo: `${doc.nome} vencida`, detalhe: 'Reemita antes da próxima sessão de habilitação.', href: '/documentos' });
      } else if (situacao === 'a-vencer') {
        lista.push({ id: doc.id, tom: 'warn', titulo: `${doc.nome} vence ${dias === 0 ? 'hoje' : `em ${dias} dia(s)`}`, detalhe: doc.emissor, href: '/documentos' });
      }
    }
    for (const card of ws.pipeline) {
      if (!ETAPAS_ATIVAS.includes(card.etapa)) continue;
      const prazo = prazoRelativo(card.oportunidade.encerramentoPropostas);
      if (prazo.tom === 'critico') {
        lista.push({
          id: card.id,
          tom: 'danger',
          titulo: `Propostas encerram ${prazo.texto}`,
          detalhe: `${tituloProprio(card.oportunidade.orgao)} — etapa “${ETAPAS.find((etapa) => etapa.id === card.etapa)?.label}”`,
          href: '/pipeline',
        });
      }
    }
    return lista.sort((a, b) => (a.tom === b.tom ? 0 : a.tom === 'danger' ? -1 : 1));
  }, [pronto, ws.documentos, ws.pipeline]);

  const eventos = useMemo(() => {
    if (!pronto) return [];
    return eventosFuturos(eventosAgenda(ws)).slice(0, 6);
  }, [ws, pronto]);

  const maiorEtapa = Math.max(1, ...ETAPAS.map((etapa) => ws.pipeline.filter((card) => card.etapa === etapa.id).length));
  const dataHoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });

  return (
    <>
      {/* Primeira visita: explorar com dados de exemplo ou testar do zero. */}
      {pronto && !ws.inicio ? (
        <section className="mb-6 flex flex-col gap-4 rounded-3xl border border-brand-200 bg-brand-50 p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-semibold text-brand-900">Você está vendo uma empresa de exemplo</p>
            <p className="mt-1 text-sm text-brand-800/80">
              O pipeline e os documentos já vêm preenchidos para mostrar a plataforma funcionando. O radar e os preços são
              sempre dados reais do PNCP. Tudo fica salvo só no seu navegador.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={() => escolherInicio('exemplo')} className="rounded-xl border border-brand-200 bg-white px-4 py-2.5 text-sm font-medium text-brand-800 transition hover:bg-brand-100">
              Explorar o exemplo
            </button>
            <button
              type="button"
              onClick={() => {
                escolherInicio('zero');
                router.push('/perfil');
              }}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-700"
            >
              Começar do zero com a minha empresa
            </button>
          </div>
        </section>
      ) : null}

      {/* Boas-vindas */}
      <section className="relative mb-6 overflow-hidden rounded-3xl bg-ink-950 px-6 py-7 text-white sm:px-8">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-[0.07] invert" />
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, #3b66f6, transparent)' }}
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm text-ink-300">
              {dataHoje.charAt(0).toUpperCase() + dataHoje.slice(1)} · {pronto ? ws.perfil.empresa : '…'}
            </p>
            <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{saudacao()}! Este é o seu painel de licitações.</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-300">
              {estado.fase === 'pronto'
                ? `O radar encontrou ${altas.length} edital(is) com alta aderência ao seu perfil entre ${itens.length} oportunidades abertas no PNCP.`
                : estado.fase === 'carregando'
                  ? 'Varrendo o PNCP pelas oportunidades abertas para o seu perfil…'
                  : 'Não foi possível consultar o PNCP agora — o restante do painel segue disponível.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/radar" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-brand-50">
              <IconRadar size={16} /> Abrir radar
            </Link>
            <Link href="/analisador" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white ring-1 ring-white/15 transition hover:bg-white/15">
              <IconSparkles size={16} /> Analisar edital
            </Link>
          </div>
        </div>
      </section>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          href="/radar"
          rotulo="Editais aderentes"
          valor={estado.fase === 'pronto' ? altas.length : estado.fase === 'carregando' ? <span className="skeleton inline-block h-7 w-10 rounded-md align-middle" /> : '—'}
          detalhe="nota ≥ 70 · propostas abertas"
          icone={<IconTarget size={18} />}
        />
        <Kpi href="/pipeline" rotulo="Valor em disputa" valor={pronto ? brlCompacto(valorEmDisputa(ws.pipeline)) : '—'} detalhe={`${ativos.length} licitação(ões) no pipeline`} icone={<IconKanban size={18} />} tom="accent" />
        <Kpi
          href="/documentos"
          rotulo="Prontidão documental"
          valor={pronto ? `${prontidaoDocumental(ws.documentos)}%` : '—'}
          detalhe={`${alertas.filter((alerta) => alerta.href === '/documentos').length} documento(s) pedindo atenção`}
          icone={<IconFolder size={18} />}
          tom={pronto && prontidaoDocumental(ws.documentos) === 100 ? 'ok' : 'warn'}
        />
        <Kpi
          href="/agenda"
          rotulo="Próximo prazo"
          valor={proximoPrazo ? prazoRelativo(proximoPrazo).texto : '—'}
          detalhe="fim de propostas no pipeline"
          icone={<IconClock size={18} />}
          tom="danger"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Painel
          titulo="Melhores oportunidades agora"
          semPadding
          acao={
            <Link href="/radar" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
              Ver todas <IconArrowRight size={13} />
            </Link>
          }
        >
          {estado.fase === 'carregando' ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }, (_, indice) => (
                <div key={indice} className="skeleton h-14 rounded-xl" />
              ))}
            </div>
          ) : estado.fase === 'erro' ? (
            <p className="p-5 text-sm text-ink-500">{estado.mensagem}</p>
          ) : melhores.length === 0 ? (
            <p className="p-5 text-sm text-ink-500">Nenhuma oportunidade aberta para os termos do perfil.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {melhores.map((item) => (
                <li key={item.id}>
                  <Link href={rotaOportunidade(item)} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-ink-50">
                    <NotaAderencia aderencia={item.aderencia} tamanho={40} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm font-medium text-ink-900">{item.objeto}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">
                        {tituloProprio(item.orgao)} · {item.uf} · {item.modalidade}
                      </span>
                    </span>
                    <span className="hidden shrink-0 flex-col items-end gap-1 text-right text-xs sm:flex">
                      <ValorEstimado item={item} />
                      <ChipPrazo iso={item.encerramentoPropostas} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Painel>

        <Painel titulo={`Atenção${alertas.length ? ` (${alertas.length})` : ''}`} semPadding>
          {alertas.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-500">Nada pendente. Documentos e prazos em dia.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {alertas.slice(0, 6).map((alerta) => (
                <li key={alerta.id}>
                  <Link href={alerta.href} className="flex gap-3 px-5 py-3 transition hover:bg-ink-50">
                    <span className={`mt-0.5 shrink-0 ${alerta.tom === 'danger' ? 'text-danger-600' : 'text-warn-500'}`}>
                      <IconAlert size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink-800">{alerta.titulo}</span>
                      <span className="block truncate text-xs text-ink-500">{alerta.detalhe}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Painel>

        <Painel
          titulo="Funil do pipeline"
          acao={
            <Link href="/pipeline" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
              Abrir <IconArrowRight size={13} />
            </Link>
          }
        >
          <ul className="space-y-3">
            {ETAPAS.map((etapa) => {
              const cards = ws.pipeline.filter((card) => card.etapa === etapa.id);
              const valor = cards.reduce((total, card) => total + (card.valorProposta ?? card.oportunidade.valorEstimado ?? 0), 0);
              return (
                <li key={etapa.id} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm">
                  <span className="text-ink-600">{etapa.label}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-ink-100">
                    <span className={`block h-full rounded-full ${etapa.cor}`} style={{ width: `${(cards.length / maiorEtapa) * 100}%` }} />
                  </span>
                  <span className="w-28 whitespace-nowrap text-right font-mono text-xs text-ink-700">
                    {cards.length} · {brlCompacto(valor || null)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Painel>

        <Painel titulo="Próximos compromissos" semPadding>
          <ListaEventos eventos={eventos} vazio="Nenhum prazo futuro no pipeline." />
        </Painel>
      </div>

      {/* Fluxo do produto — orienta quem chega pela primeira vez */}
      <section className="mt-8 grid gap-3 md:grid-cols-4">
        {[
          { icone: <IconRadar size={18} />, titulo: '1. Encontrar', texto: 'O radar varre o PNCP e pontua cada edital pelo seu perfil.', href: '/radar' },
          { icone: <IconSparkles size={18} />, titulo: '2. Entender', texto: 'A IA lê o edital inteiro e aponta prazos, exigências e riscos.', href: '/analisador' },
          { icone: <IconChart size={18} />, titulo: '3. Precificar', texto: 'Veja por quanto itens parecidos foram vencidos.', href: '/precos' },
          { icone: <IconKanban size={18} />, titulo: '4. Disputar', texto: 'Pipeline, documentos e agenda para não perder prazo.', href: '/pipeline' },
        ].map((passo) => (
          <Link key={passo.titulo} href={passo.href} className="group rounded-2xl border border-ink-200 bg-white p-4 transition hover:border-brand-200 hover:shadow-soft">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <span className="text-brand-600">{passo.icone}</span>
              {passo.titulo}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-ink-500">{passo.texto}</span>
          </Link>
        ))}
      </section>
    </>
  );
}
