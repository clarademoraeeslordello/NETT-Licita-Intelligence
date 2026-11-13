'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  IconChart,
  IconChevron,
  IconDocument,
  IconDownload,
  IconExternal,
  IconMapPin,
  IconSparkles,
} from '@/components/icons';
import { calcularAderencia } from '@/lib/plataforma/aderencia';
import { brl, brlCompacto, cnpjFormatado, dataHora, tituloProprio } from '@/lib/plataforma/formato';
import { palavrasChave } from '@/lib/plataforma/texto';
import type { CompraCompleta } from '@/lib/pncp/compra';
import type { ItemCompra } from '@/lib/pncp/types';
import { BotaoPipeline, DecomposicaoNota } from './cartao-oportunidade';
import { useWorkspace } from './workspace-provider';
import { Aviso, botaoPrimario, botaoSecundario, ChipPrazo, ErroCarregamento, LinhasEsqueleto, NotaAderencia, Painel } from './ui';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'pronto'; dados: CompraCompleta }
  | { fase: 'erro'; mensagem: string; dica?: string };

/** Consulta de preço a partir da descrição do item: as 3 primeiras palavras significativas. */
const consultaPreco = (descricao: string) => palavrasChave(descricao).slice(0, 3).join(' ');

const exclusivoMeEpp = (item: ItemCompra) => /exclusiva/i.test(item.beneficio ?? '');

export function OportunidadeView({ cnpj, ano, seq }: { cnpj: string; ano: string; seq: string }) {
  const { ws, pronto, adicionarAoPipeline } = useWorkspace();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [tentativa, setTentativa] = useState(0);
  const [itensVisiveis, setItensVisiveis] = useState(12);

  useEffect(() => {
    const controle = new AbortController();
    setEstado({ fase: 'carregando' });
    fetch(`/api/pncp/compra/${cnpj}/${ano}/${seq}`, { signal: controle.signal })
      .then(async (res) => {
        const corpo = (await res.json()) as CompraCompleta & { error?: { message: string; hint?: string } };
        if (!res.ok || corpo.error) setEstado({ fase: 'erro', mensagem: corpo.error?.message ?? 'Não foi possível carregar a contratação.', dica: corpo.error?.hint });
        else setEstado({ fase: 'pronto', dados: corpo });
      })
      .catch((erro: Error) => {
        if (erro.name !== 'AbortError') setEstado({ fase: 'erro', mensagem: 'Falha de comunicação com o servidor.' });
      });
    return () => controle.abort();
  }, [cnpj, ano, seq, tentativa]);

  const dados = estado.fase === 'pronto' ? estado.dados : null;
  const aderencia = useMemo(() => (dados && pronto ? calcularAderencia(dados.oportunidade, ws.perfil) : null), [dados, pronto, ws.perfil]);
  const noPipeline = ws.pipeline.some((card) => card.id === `${cnpj}-${ano}-${seq}`);

  const voltar = (
    <Link href="/radar" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-500 transition hover:text-ink-900">
      <IconChevron size={15} className="rotate-180" /> Radar de editais
    </Link>
  );

  if (estado.fase === 'carregando') {
    return (
      <>
        {voltar}
        <div className="skeleton mb-3 h-6 w-72 rounded-lg" />
        <div className="skeleton mb-6 h-16 w-full max-w-3xl rounded-xl" />
        <LinhasEsqueleto linhas={3} altura="h-40" />
      </>
    );
  }

  if (estado.fase === 'erro') {
    return (
      <>
        {voltar}
        <ErroCarregamento mensagem={estado.mensagem} dica={estado.dica} onTentar={() => setTentativa((valor) => valor + 1)} />
      </>
    );
  }

  const { oportunidade: op, detalhe, itens, arquivos, avisos } = estado.dados;
  const exclusivos = itens?.filter(exclusivoMeEpp).length ?? 0;
  const termoPreco = aderencia?.termosEncontrados[0] ?? (itens?.[0] ? consultaPreco(itens[0].descricao) : '');

  const fatos: Array<[string, React.ReactNode]> = [
    ['Valor estimado', op.valorEstimado !== null ? brl(op.valorEstimado) : detalhe?.orcamentoSigiloso ? 'Sigiloso' : 'Não informado'],
    ['Propostas a partir de', dataHora(op.aberturaPropostas)],
    ['Propostas até', <span key="prazo" className="inline-flex flex-wrap items-center gap-2">{dataHora(op.encerramentoPropostas)} <ChipPrazo iso={op.encerramentoPropostas} /></span>],
    ['Situação', op.situacao || detalhe?.situacao || '—'],
    ['Modalidade', op.modalidade],
    ['Modo de disputa', detalhe?.modoDisputa ?? '—'],
    ['Registro de preços', detalhe ? (detalhe.srp ? 'Sim (SRP)' : 'Não') : '—'],
    ['Processo', detalhe?.processo ?? '—'],
    ['Amparo legal', detalhe?.amparoLegal ?? '—'],
    ['Nº de controle PNCP', <span key="ctrl" className="font-mono text-xs">{op.numeroControle}</span>],
  ];
  // Campos do detalhe (/consulta) somem quando o PNCP não os entregou, em vez de virar uma grade de "—".
  const fatosVisiveis = fatos.filter(([, valor]) => valor !== '—');

  return (
    <>
      {voltar}

      {/* Cabeçalho */}
      <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
            <span className="font-medium text-ink-800">{tituloProprio(op.orgao)}</span>
            <span className="inline-flex items-center gap-1">
              <IconMapPin size={13} /> {op.municipio ? `${tituloProprio(op.municipio)}/` : ''}
              {op.uf}
            </span>
            <span className="text-ink-300">·</span>
            <span>{op.esfera}</span>
            <span className="text-ink-300">·</span>
            <span className="font-mono text-xs">CNPJ {cnpjFormatado(op.cnpj)}</span>
          </div>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
            {op.titulo || 'Contratação'} · {op.modalidade}
          </p>
          <h1 className="text-pretty mt-1 text-xl font-semibold leading-snug text-ink-900 sm:text-2xl">{op.objeto}</h1>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 lg:flex-col lg:items-stretch">
          <Link href={`/analisador?pncp=${cnpj}/${ano}/${seq}`} className={botaoPrimario}>
            <IconSparkles size={16} /> Analisar edital com IA
          </Link>
          <div className="flex gap-2">
            <BotaoPipeline noPipeline={noPipeline} onAdicionar={() => adicionarAoPipeline(op)} />
            <a href={op.linkPncp} target="_blank" rel="noreferrer" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 transition hover:border-ink-300 hover:bg-ink-50">
              <IconExternal size={14} /> PNCP
            </a>
          </div>
        </div>
      </div>

      {avisos.map((aviso) => (
        <div key={aviso} className="mb-4">
          <Aviso titulo={aviso} />
        </div>
      ))}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Painel titulo="Dados da contratação">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {fatosVisiveis.map(([rotulo, valor]) => (
                <div key={rotulo} className="min-w-0">
                  <dt className="text-xs text-ink-500">{rotulo}</dt>
                  <dd className="mt-0.5 break-words text-sm font-medium text-ink-900">{valor}</dd>
                </div>
              ))}
            </dl>
            {detalhe?.informacaoComplementar ? (
              <p className="mt-5 rounded-xl bg-ink-50 p-3 text-sm leading-relaxed text-ink-600">{detalhe.informacaoComplementar}</p>
            ) : null}
          </Painel>

          <Painel
            titulo={`Itens${itens ? ` (${itens.length})` : ''}`}
            semPadding
            acao={
              exclusivos > 0 ? (
                <span className="rounded-full bg-accent-400/15 px-2.5 py-1 text-xs font-medium text-accent-600">
                  {exclusivos} exclusivo(s) ME/EPP
                </span>
              ) : undefined
            }
          >
            {itens === null ? (
              <p className="p-5 text-sm text-ink-500">Itens indisponíveis no momento.</p>
            ) : itens.length === 0 ? (
              <p className="p-5 text-sm text-ink-500">O órgão não publicou itens para esta contratação.</p>
            ) : (
              <>
                <div className="scrollbar-slim relative overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-ink-50 text-xs text-ink-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">#</th>
                        <th className="px-4 py-2.5 font-medium">Descrição</th>
                        <th className="px-4 py-2.5 text-right font-medium">Qtd.</th>
                        <th className="px-4 py-2.5 text-right font-medium">Unitário est.</th>
                        <th className="px-4 py-2.5 text-right font-medium">Total est.</th>
                        <th className="px-4 py-2.5 font-medium"><span className="sr-only">Ações</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {itens.slice(0, itensVisiveis).map((item) => (
                        <tr key={item.numero} className="align-top">
                          <td className="px-4 py-3 font-mono text-xs text-ink-500">{item.numero}</td>
                          <td className="max-w-md px-4 py-3">
                            <p className="line-clamp-2 text-ink-800" title={item.descricao}>
                              {item.descricao}
                            </p>
                            <p className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ink-500">
                              <span>{item.tipo}</span>
                              {item.criterioJulgamento ? <span>· {item.criterioJulgamento}</span> : null}
                              {exclusivoMeEpp(item) ? <span className="font-medium text-accent-600">· Exclusivo ME/EPP</span> : null}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs">
                            {item.quantidade.toLocaleString('pt-BR')} {item.unidade}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs">{brl(item.valorUnitarioEstimado, { centavos: true })}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs font-semibold">{brlCompacto(item.valorTotalEstimado)}</td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/precos?q=${encodeURIComponent(consultaPreco(item.descricao))}`}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-50"
                              title="Quanto já foi pago por itens parecidos"
                            >
                              <IconChart size={13} /> Preços
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {itens.length > itensVisiveis ? (
                  <div className="border-t border-ink-100 p-3 text-center">
                    <button type="button" onClick={() => setItensVisiveis((valor) => valor + 25)} className="text-sm font-medium text-brand-700">
                      Mostrar mais itens ({itens.length - itensVisiveis} restantes)
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </Painel>
        </div>

        <aside className="space-y-5">
          {aderencia ? (
            <Painel titulo="Aderência ao seu perfil">
              <div className="mb-4 flex items-center gap-4">
                <NotaAderencia aderencia={aderencia} tamanho={64} />
                <p className="text-sm text-ink-600">
                  {aderencia.faixa === 'alta'
                    ? 'Forte candidata: vale priorizar a leitura do edital.'
                    : aderencia.faixa === 'media'
                      ? 'Aderência parcial: confira os itens antes de investir tempo.'
                      : 'Baixa aderência ao perfil atual.'}
                </p>
              </div>
              <DecomposicaoNota item={{ ...op, termos: [], aderencia, valorStatus: 'ok' }} />
            </Painel>
          ) : null}

          {termoPreco ? (
            <Link
              href={`/precos?q=${encodeURIComponent(termoPreco)}`}
              className="block rounded-2xl border border-brand-200 bg-brand-50 p-5 transition hover:shadow-lift"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-brand-800">
                <IconChart size={18} /> Quanto ofertar?
              </span>
              <span className="mt-1 block text-sm text-brand-800/80">
                Veja os preços que venceram licitações de “{termoPreco}” no PNCP.
              </span>
            </Link>
          ) : null}

          <Painel titulo="Arquivos publicados" semPadding>
            {arquivos === null ? (
              <p className="p-5 text-sm text-ink-500">Lista indisponível no momento.</p>
            ) : arquivos.length === 0 ? (
              <p className="p-5 text-sm text-ink-500">Nenhum arquivo publicado no PNCP.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {arquivos.map((arquivo) => (
                  <li key={arquivo.sequencial}>
                    <a
                      href={arquivo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 px-5 py-3 transition hover:bg-ink-50"
                    >
                      <span className="text-ink-400">
                        <IconDocument size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-800">{arquivo.titulo}</span>
                        <span className="text-xs text-ink-500">{arquivo.tipo}</span>
                      </span>
                      <IconDownload size={16} className="text-ink-400" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Painel>

          {detalhe?.linkSistemaOrigem ? (
            <a href={detalhe.linkSistemaOrigem} target="_blank" rel="noreferrer" className={`${botaoSecundario} w-full`}>
              <IconExternal size={15} /> Sistema de disputa do órgão
            </a>
          ) : null}
        </aside>
      </div>
    </>
  );
}
