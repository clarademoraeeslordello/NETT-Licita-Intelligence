'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { IconRadar, IconRefresh, IconSearch, IconUser } from '@/components/icons';
import { dataHora } from '@/lib/plataforma/formato';
import { normalizar } from '@/lib/plataforma/texto';
import { CartaoOportunidade } from './cartao-oportunidade';
import { useRadar } from './use-radar';
import { useWorkspace } from './workspace-provider';
import { Aviso, botaoFantasma, botaoSecundario, ErroCarregamento, LinhasEsqueleto, PageHeader, Vazio } from './ui';

type FiltroFaixa = 'todas' | 'alta' | 'media+';
type FiltroPrazo = 'todos' | 'curto' | 'confortavel';

const POR_PAGINA = 15;

export function RadarView() {
  const { ws, pronto, adicionarAoPipeline, descartar, restaurarDescartadas } = useWorkspace();
  const { estado, itens, recarregar, carregandoValores } = useRadar();

  const [busca, setBusca] = useState('');
  const [faixa, setFaixa] = useState<FiltroFaixa>('media+');
  const [uf, setUf] = useState('');
  const [prazo, setPrazo] = useState<FiltroPrazo>('todos');
  const [limite, setLimite] = useState(POR_PAGINA);

  const noPipeline = useMemo(() => new Set(ws.pipeline.map((card) => card.id)), [ws.pipeline]);
  const descartadas = useMemo(() => new Set(ws.descartadas), [ws.descartadas]);

  const ufsDisponiveis = useMemo(() => [...new Set(itens.map((item) => item.uf).filter(Boolean))].sort(), [itens]);

  const filtrados = useMemo(() => {
    const alvo = normalizar(busca);
    return itens.filter((item) => {
      if (descartadas.has(item.id)) return false;
      if (faixa === 'alta' && item.aderencia.faixa !== 'alta') return false;
      if (faixa === 'media+' && item.aderencia.faixa === 'baixa') return false;
      if (uf && item.uf !== uf) return false;
      if (prazo !== 'todos' && item.encerramentoPropostas) {
        const dias = (new Date(item.encerramentoPropostas).getTime() - Date.now()) / 86_400_000;
        if (prazo === 'curto' && dias > 7) return false;
        if (prazo === 'confortavel' && dias <= 7) return false;
      }
      if (alvo && !normalizar(`${item.objeto} ${item.orgao} ${item.municipio}`).includes(alvo)) return false;
      return true;
    });
  }, [itens, descartadas, faixa, uf, prazo, busca]);

  const contagem = useMemo(
    () => ({
      alta: itens.filter((item) => item.aderencia.faixa === 'alta' && !descartadas.has(item.id)).length,
      media: itens.filter((item) => item.aderencia.faixa === 'media' && !descartadas.has(item.id)).length,
    }),
    [itens, descartadas],
  );

  const resposta = estado.fase === 'pronto' ? estado.resposta : null;

  return (
    <>
      <PageHeader
        eyebrow="PNCP · propostas abertas"
        titulo="Radar de editais"
        descricao={
          <>
            Editais publicados no Portal Nacional de Contratações Públicas que ainda recebem propostas, ordenados pela
            aderência ao perfil de <strong className="font-medium text-nett-text">{pronto ? ws.perfil.empresa : '…'}</strong>.
          </>
        }
        acoes={
          <>
            <Link href="/perfil" className={botaoSecundario}>
              <IconUser size={16} /> Ajustar perfil
            </Link>
            <button type="button" onClick={recarregar} className={botaoSecundario} disabled={estado.fase === 'carregando'}>
              <IconRefresh size={16} className={estado.fase === 'carregando' ? 'animate-spin' : ''} /> Atualizar
            </button>
          </>
        }
      />

      {/* Resumo da varredura */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {resposta ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
              resposta.fonte === 'pncp' ? 'bg-nett-gold/20 text-nett-gold-light' : 'bg-nett-gold-dark/30 text-nett-gold-light'
            }`}
          >
            <span className={`size-1.5 rounded-full ${resposta.fonte === 'pncp' ? 'animate-pulse bg-nett-gold' : 'bg-nett-gold'}`} />
            {resposta.fonte === 'pncp' ? 'Dados ao vivo do PNCP' : `Amostra de ${dataHora(resposta.capturadoEm)}`}
          </span>
        ) : null}
        {pronto
          ? ws.perfil.termos.map((termo) => (
              <span key={termo} className="rounded-full bg-nett-surface px-2.5 py-1 text-nett-text shadow-ring">
                {termo}
              </span>
            ))
          : null}
        {pronto && ws.perfil.ufs.length ? (
          <span className="rounded-full bg-nett-surface px-2.5 py-1 text-nett-text shadow-ring">{ws.perfil.ufs.join(' · ')}</span>
        ) : null}
      </div>

      {resposta?.avisos.map((aviso) => (
        <div key={aviso} className="mb-4">
          <Aviso titulo={aviso} />
        </div>
      ))}

      {estado.fase === 'erro' ? <ErroCarregamento mensagem={estado.mensagem} dica={estado.dica} onTentar={recarregar} /> : null}

      {estado.fase === 'carregando' ? (
        <div>
          <p className="mb-4 flex items-center gap-2 text-sm text-nett-text-muted" role="status">
            <IconRadar size={16} className="animate-spin text-nett-gold [animation-duration:2.4s]" />
            Varrendo o PNCP pelos termos do perfil…
          </p>
          <LinhasEsqueleto linhas={6} altura="h-32" />
        </div>
      ) : null}

      {estado.fase === 'pronto' ? (
        <>
          {/* Filtros */}
          <div className="mb-4 grid gap-3 rounded-2xl border border-nett-text-muted/15 bg-nett-surface p-3 shadow-soft sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]">
            <label className="relative block">
              <span className="sr-only">Filtrar resultados</span>
              <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nett-text-muted" />
              <input
                type="search"
                value={busca}
                onChange={(event) => {
                  setBusca(event.target.value);
                  setLimite(POR_PAGINA);
                }}
                placeholder="Filtrar por objeto, órgão ou cidade"
                className="w-full rounded-xl border border-nett-text-muted/15 bg-nett-black/60 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-nett-gold focus:bg-nett-surface"
              />
            </label>
            <div className="flex rounded-xl bg-nett-raised p-1 text-xs font-medium" role="group" aria-label="Faixa de aderência">
              {(
                [
                  ['alta', `Alta (${contagem.alta})`],
                  ['media+', `Média+ (${contagem.alta + contagem.media})`],
                  ['todas', 'Todas'],
                ] as Array<[FiltroFaixa, string]>
              ).map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={faixa === valor}
                  onClick={() => {
                    setFaixa(valor);
                    setLimite(POR_PAGINA);
                  }}
                  className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 transition ${faixa === valor ? 'bg-nett-surface text-nett-text shadow-soft' : 'text-nett-text-muted hover:text-nett-text'}`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            <select
              value={uf}
              onChange={(event) => setUf(event.target.value)}
              aria-label="Filtrar por UF"
              className="rounded-xl border border-nett-text-muted/15 bg-nett-surface px-3 py-2 text-sm text-nett-text"
            >
              <option value="">Todas as UFs</option>
              {ufsDisponiveis.map((sigla) => (
                <option key={sigla} value={sigla}>
                  {sigla}
                </option>
              ))}
            </select>
            <select
              value={prazo}
              onChange={(event) => setPrazo(event.target.value as FiltroPrazo)}
              aria-label="Filtrar por prazo"
              className="rounded-xl border border-nett-text-muted/15 bg-nett-surface px-3 py-2 text-sm text-nett-text"
            >
              <option value="todos">Qualquer prazo</option>
              <option value="curto">Encerra em até 7 dias</option>
              <option value="confortavel">Mais de 7 dias</option>
            </select>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-nett-text-muted">
            <p>
              <strong className="font-semibold text-nett-text">{filtrados.length}</strong> de {itens.length} oportunidades
              {carregandoValores ? ' · consultando valores estimados…' : ''}
            </p>
            {ws.descartadas.length ? (
              <button type="button" onClick={restaurarDescartadas} className={botaoFantasma}>
                Restaurar {ws.descartadas.length} descartada(s)
              </button>
            ) : null}
          </div>

          {filtrados.length === 0 ? (
            <Vazio
              icone={<IconRadar size={24} />}
              titulo="Nenhuma oportunidade com esses filtros"
              acao={
                <button
                  type="button"
                  className={botaoSecundario}
                  onClick={() => {
                    setFaixa('todas');
                    setUf('');
                    setPrazo('todos');
                    setBusca('');
                  }}
                >
                  Limpar filtros
                </button>
              }
            >
              Amplie a faixa de aderência ou adicione termos e UFs no perfil da empresa.
            </Vazio>
          ) : (
            <div className="space-y-3">
              {filtrados.slice(0, limite).map((item) => (
                <CartaoOportunidade
                  key={item.id}
                  item={item}
                  noPipeline={noPipeline.has(item.id)}
                  onAdicionar={() => adicionarAoPipeline(item)}
                  onDescartar={() => descartar(item.id)}
                />
              ))}
              {filtrados.length > limite ? (
                <div className="pt-2 text-center">
                  <button type="button" onClick={() => setLimite((valor) => valor + POR_PAGINA)} className={botaoSecundario}>
                    Mostrar mais {Math.min(POR_PAGINA, filtrados.length - limite)}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
