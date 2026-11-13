'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { IconCalendar, IconChevron } from '@/components/icons';
import { eventosAgenda, eventosFuturos, TIPO_EVENTO, type EventoAgenda } from '@/lib/plataforma/agenda';
import { chaveDia, dataDia } from '@/lib/plataforma/formato';
import { useWorkspace } from './workspace-provider';
import { LinhasEsqueleto, PageHeader, Painel } from './ui';

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = (valor: number) => String(valor).padStart(2, '0');

function horaBrasilia(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

export function ListaEventos({ eventos, vazio }: { eventos: EventoAgenda[]; vazio: string }) {
  if (eventos.length === 0) return <p className="px-5 py-8 text-center text-sm text-ink-500">{vazio}</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {eventos.map((evento) => (
        <li key={evento.id}>
          <Link href={evento.href} className="flex gap-3 px-5 py-3 transition hover:bg-ink-50">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TIPO_EVENTO[evento.tipo].ponto}`} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-ink-500">
                <span>{TIPO_EVENTO[evento.tipo].rotulo}</span>
                <span className="font-mono">
                  {dataDia(evento.dia)}
                  {evento.quando ? ` · ${horaBrasilia(evento.quando)}` : ''}
                </span>
              </span>
              <span className="mt-0.5 line-clamp-2 text-sm text-ink-800">{evento.titulo}</span>
              <span className="block truncate text-xs text-ink-500">{evento.detalhe}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AgendaView() {
  const { ws, pronto } = useWorkspace();
  const hoje = chaveDia(new Date());
  const [ano, mes] = hoje.split('-').map(Number);
  const [cursor, setCursor] = useState({ ano, mes });
  const [selecionado, setSelecionado] = useState(hoje);

  const eventos = useMemo(() => (pronto ? eventosAgenda(ws) : []), [ws, pronto]);
  const porDia = useMemo(() => {
    const mapa = new Map<string, EventoAgenda[]>();
    for (const evento of eventos) mapa.set(evento.dia, [...(mapa.get(evento.dia) ?? []), evento]);
    return mapa;
  }, [eventos]);

  // Grade do mês: começa no domingo da semana do dia 1.
  const celulas = useMemo(() => {
    const primeiro = new Date(Date.UTC(cursor.ano, cursor.mes - 1, 1));
    const inicio = new Date(primeiro);
    inicio.setUTCDate(1 - primeiro.getUTCDay());
    return Array.from({ length: 42 }, (_, indice) => {
      const data = new Date(inicio);
      data.setUTCDate(inicio.getUTCDate() + indice);
      return {
        chave: `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())}`,
        dia: data.getUTCDate(),
        doMes: data.getUTCMonth() === cursor.mes - 1,
      };
    });
  }, [cursor]);

  const tituloMes = new Date(Date.UTC(cursor.ano, cursor.mes - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const proximos = eventosFuturos(eventos).slice(0, 12);
  const mover = (delta: number) =>
    setCursor((atual) => {
      const total = atual.ano * 12 + (atual.mes - 1) + delta;
      return { ano: Math.floor(total / 12), mes: (total % 12) + 1 };
    });

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        titulo="Agenda"
        descricao="Prazos de propostas das licitações do pipeline e vencimentos de documentos, num só calendário."
      />

      {!pronto ? (
        <LinhasEsqueleto linhas={1} altura="h-96" />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
          <Painel
            titulo={<span className="capitalize">{tituloMes}</span>}
            acao={
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => mover(-1)} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100" aria-label="Mês anterior">
                  <IconChevron size={16} className="rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCursor({ ano, mes });
                    setSelecionado(hoje);
                  }}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-ink-100"
                >
                  Hoje
                </button>
                <button type="button" onClick={() => mover(1)} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100" aria-label="Próximo mês">
                  <IconChevron size={16} />
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-ink-400">
              {DIAS_SEMANA.map((dia) => (
                <span key={dia} className="py-1">
                  {dia}
                </span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {celulas.map((celula) => {
                const doDia = porDia.get(celula.chave) ?? [];
                const ehHoje = celula.chave === hoje;
                const ativo = celula.chave === selecionado;
                return (
                  <button
                    key={celula.chave}
                    type="button"
                    onClick={() => setSelecionado(celula.chave)}
                    aria-pressed={ativo}
                    aria-label={`${dataDia(celula.chave)}${doDia.length ? `, ${doDia.length} evento(s)` : ''}`}
                    className={`flex min-h-16 flex-col items-start rounded-xl border p-1.5 text-left transition sm:min-h-24 sm:p-2 ${
                      ativo ? 'border-brand-400 bg-brand-50' : 'border-transparent hover:bg-ink-50'
                    } ${celula.doMes ? '' : 'opacity-40'}`}
                  >
                    <span
                      className={`flex size-6 items-center justify-center rounded-full font-mono text-xs ${
                        ehHoje ? 'bg-brand-600 font-semibold text-white' : 'text-ink-700'
                      }`}
                    >
                      {celula.dia}
                    </span>
                    {/* Desktop: títulos curtos. Mobile: só os pontos. */}
                    <span className="mt-1 hidden w-full space-y-0.5 sm:block">
                      {doDia.slice(0, 2).map((evento) => (
                        <span key={evento.id} className={`block truncate rounded px-1 py-px text-[10px] font-medium ${TIPO_EVENTO[evento.tipo].chip}`}>
                          {evento.titulo}
                        </span>
                      ))}
                      {doDia.length > 2 ? <span className="block px-1 text-[10px] text-ink-500">+{doDia.length - 2}</span> : null}
                    </span>
                    <span className="mt-1 flex gap-0.5 sm:hidden">
                      {doDia.slice(0, 3).map((evento) => (
                        <span key={evento.id} className={`size-1.5 rounded-full ${TIPO_EVENTO[evento.tipo].ponto}`} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
              {Object.values(TIPO_EVENTO).map((tipo) => (
                <span key={tipo.rotulo} className="inline-flex items-center gap-1.5">
                  <span className={`size-2 rounded-full ${tipo.ponto}`} /> {tipo.rotulo}
                </span>
              ))}
            </div>
          </Painel>

          <div className="space-y-5">
            <Painel titulo={`Dia ${dataDia(selecionado)}`} semPadding>
              <ListaEventos eventos={porDia.get(selecionado) ?? []} vazio="Nada agendado para este dia." />
            </Painel>
            <Painel titulo="Próximos compromissos" semPadding acao={<IconCalendar size={16} className="text-ink-400" />}>
              <ListaEventos eventos={proximos} vazio="Nenhum prazo futuro. Adicione editais ao pipeline pelo Radar." />
            </Painel>
          </div>
        </div>
      )}
    </>
  );
}
