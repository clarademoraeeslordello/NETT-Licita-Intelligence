'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconChart, IconExternal, IconSearch, IconTrophy } from '@/components/icons';
import { estatisticasPrecos, type EstatisticaPrecos } from '@/lib/plataforma/precos';
import { brl, cnpjFormatado, dataLonga, dataHora, tituloProprio } from '@/lib/plataforma/formato';
import type { EventoPrecos } from '@/lib/pncp/precos';
import type { AmostraPreco } from '@/lib/pncp/types';
import { useWorkspace } from './workspace-provider';
import { Aviso, botaoPrimario, ErroCarregamento, PageHeader, Painel, Vazio } from './ui';

const SUGESTOES = ['notebook', 'papel a4', 'cadeira giratória', 'toner', 'ar condicionado', 'monitor'];

type Estado =
  | { fase: 'ocioso' }
  | { fase: 'coletando' | 'pronto'; consulta: string; fonte: 'pncp' | 'amostra'; capturadoEm?: string; mensagem: string; concluido: number; total: number; comprasAnalisadas: number; duracaoMs: number }
  | { fase: 'erro'; mensagem: string; dica?: string };

export function PrecosView() {
  const router = useRouter();
  const params = useSearchParams();
  const { ws, pronto } = useWorkspace();
  const consultaUrl = params.get('q') ?? '';
  const ufUrl = params.get('uf') ?? '';

  const [texto, setTexto] = useState(consultaUrl);
  const [uf, setUf] = useState(ufUrl);
  const [estado, setEstado] = useState<Estado>({ fase: 'ocioso' });
  const [amostras, setAmostras] = useState<AmostraPreco[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const coletar = useCallback(async (consulta: string, siglaUf: string) => {
    abortRef.current?.abort();
    const controle = new AbortController();
    abortRef.current = controle;
    setAmostras([]);
    setEstado({ fase: 'coletando', consulta, fonte: 'pncp', mensagem: 'Buscando licitações encerradas com resultado…', concluido: 0, total: 0, comprasAnalisadas: 0, duracaoMs: 0 });

    try {
      const res = await fetch(`/api/precos?q=${encodeURIComponent(consulta)}${siglaUf ? `&ufs=${siglaUf}` : ''}`, { signal: controle.signal });
      const leitor = res.body?.getReader();
      if (!leitor) throw new Error('sem stream');
      const decoder = new TextDecoder();
      let buffer = '';

      const processar = (evento: EventoPrecos) => {
        switch (evento.tipo) {
          case 'inicio':
            setEstado((atual) => (atual.fase === 'coletando' ? { ...atual, fonte: evento.fonte, capturadoEm: evento.capturadoEm } : atual));
            break;
          case 'progresso':
            setEstado((atual) => (atual.fase === 'coletando' ? { ...atual, mensagem: evento.mensagem, concluido: evento.concluido, total: evento.total } : atual));
            break;
          case 'amostras':
            setAmostras((atual) => {
              const vistos = new Set(atual.map((amostra) => amostra.id));
              return [...atual, ...evento.amostras.filter((amostra) => !vistos.has(amostra.id))];
            });
            break;
          case 'fim':
            setEstado((atual) =>
              atual.fase === 'coletando'
                ? { ...atual, fase: 'pronto', fonte: evento.fonte, comprasAnalisadas: evento.comprasAnalisadas, duracaoMs: evento.duracaoMs }
                : atual,
            );
            break;
          case 'erro':
            setEstado({ fase: 'erro', mensagem: evento.mensagem, dica: evento.dica });
            break;
        }
      };

      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const linhas = buffer.split('\n');
        buffer = linhas.pop() ?? '';
        for (const linha of linhas) if (linha.trim()) processar(JSON.parse(linha) as EventoPrecos);
      }
      setEstado((atual) => (atual.fase === 'coletando' ? { ...atual, fase: 'pronto' } : atual));
    } catch (erro) {
      if ((erro as Error).name === 'AbortError') return;
      setEstado({ fase: 'erro', mensagem: 'A coleta de preços foi interrompida.', dica: 'Verifique a conexão e tente novamente.' });
    }
  }, []);

  // A URL é a fonte da verdade: permite compartilhar e voltar pelo histórico.
  useEffect(() => {
    setTexto(consultaUrl);
    setUf(ufUrl);
    if (consultaUrl.trim().length >= 2) void coletar(consultaUrl.trim(), ufUrl);
    else setEstado({ fase: 'ocioso' });
  }, [consultaUrl, ufUrl, coletar]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pesquisar = (consulta: string, siglaUf = uf) => {
    const alvo = consulta.trim();
    if (alvo.length < 2) return;
    const query = new URLSearchParams({ q: alvo });
    if (siglaUf) query.set('uf', siglaUf);
    router.push(`/precos?${query}`);
  };

  const stats = useMemo(() => estatisticasPrecos(amostras), [amostras]);
  const coletando = estado.fase === 'coletando';

  return (
    <>
      <PageHeader
        eyebrow="Inteligência de preços · PNCP"
        titulo="Quanto os vencedores ofertaram?"
        descricao="Preços homologados — o valor que de fato venceu — de itens parecidos em licitações já encerradas. Use como referência para a sua proposta, não como regra."
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          pesquisar(texto);
        }}
        className="mb-3 grid gap-2 rounded-2xl border border-ink-200 bg-white p-2 shadow-soft sm:grid-cols-[1fr_auto_auto]"
      >
        <label className="relative block">
          <span className="sr-only">Item a precificar</span>
          <IconSearch size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            placeholder='Ex.: "notebook i5", "papel A4", "cadeira giratória"'
            className="w-full rounded-xl bg-transparent py-3 pl-11 pr-3 text-[15px] outline-none"
            maxLength={120}
          />
        </label>
        <select
          value={uf}
          onChange={(event) => setUf(event.target.value)}
          aria-label="Filtrar por UF"
          className="rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2.5 text-sm text-ink-700"
        >
          <option value="">Brasil inteiro</option>
          {(pronto ? ws.perfil.ufs : []).map((sigla) => (
            <option key={sigla} value={sigla}>
              Só {sigla}
            </option>
          ))}
        </select>
        <button type="submit" className={botaoPrimario} disabled={texto.trim().length < 2}>
          <IconChart size={16} /> Pesquisar preços
        </button>
      </form>

      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-500">Experimente:</span>
        {SUGESTOES.map((sugestao) => (
          <button
            key={sugestao}
            type="button"
            onClick={() => pesquisar(sugestao)}
            className="rounded-full bg-white px-2.5 py-1 text-ink-600 shadow-ring transition hover:text-brand-700"
          >
            {sugestao}
          </button>
        ))}
      </div>

      {estado.fase === 'ocioso' ? (
        <Vazio icone={<IconChart size={24} />} titulo="Pesquise um item para ver os preços vencedores">
          O LicitaFlow lê licitações encerradas no PNCP, encontra itens com a mesma descrição e mostra quem venceu, por quanto
          e com que desconto sobre o valor estimado.
        </Vazio>
      ) : null}

      {estado.fase === 'erro' ? <ErroCarregamento mensagem={estado.mensagem} dica={estado.dica} onTentar={() => pesquisar(consultaUrl || texto)} /> : null}

      {estado.fase === 'coletando' || estado.fase === 'pronto' ? (
        <>
          {estado.fonte === 'amostra' ? (
            <div className="mb-4">
              <Aviso titulo={`PNCP indisponível — exibindo amostra capturada em ${dataHora(estado.capturadoEm)}.`} />
            </div>
          ) : null}

          {coletando ? (
            <div className="mb-5 rounded-2xl border border-brand-200 bg-brand-50/60 p-4" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="font-medium text-brand-800">{estado.mensagem}</p>
                <span className="font-mono text-xs text-brand-700">{amostras.length} preço(s)</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-100">
                <div
                  className={`h-full rounded-full bg-brand-500 transition-[width] duration-500 ${estado.total ? '' : 'w-1/4 animate-pulse'}`}
                  style={estado.total ? { width: `${Math.max(6, (estado.concluido / estado.total) * 100)}%` } : undefined}
                />
              </div>
              <p className="mt-2 text-xs text-brand-800/70">
                O PNCP responde item a item; os resultados aparecem conforme chegam.
              </p>
            </div>
          ) : (
            <p className="mb-4 text-sm text-ink-500">
              {amostras.length} preço(s) vencedor(es) em {estado.comprasAnalisadas} licitação(ões) encerrada(s) para{' '}
              <strong className="font-medium text-ink-800">“{estado.consulta}”</strong>
              {estado.duracaoMs >= 500 ? ` · ${(estado.duracaoMs / 1000).toFixed(1).replace('.', ',')} s` : ''}
            </p>
          )}

          {stats ? (
            <Resultado stats={stats} amostras={amostras} consulta={estado.consulta} />
          ) : estado.fase === 'pronto' ? (
            <Vazio icone={<IconSearch size={24} />} titulo={`Nenhum preço vencedor encontrado para “${estado.consulta}”`}>
              Tente uma descrição mais curta e genérica (ex.: “notebook” em vez de “notebook dell i7 16gb”) ou remova o
              filtro de UF.
            </Vazio>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function Resultado({ stats, amostras, consulta }: { stats: EstatisticaPrecos; amostras: AmostraPreco[]; consulta: string }) {
  const [ordem, setOrdem] = useState<'preco' | 'data'>('preco');
  const unidade = stats.unidade;
  const tabela = useMemo(
    () =>
      [...amostras].sort((a, b) =>
        ordem === 'preco'
          ? a.valorHomologadoUnitario - b.valorHomologadoUnitario
          : (b.dataResultado ?? '').localeCompare(a.dataResultado ?? ''),
      ),
    [amostras, ordem],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Destaque rotulo={`Preço mediano / ${unidade}`} valor={brl(stats.mediana, { centavos: true })} detalhe={`${stats.amostras} amostras na unidade ${unidade}`} forte />
        <Destaque rotulo="Faixa competitiva" valor={`${brl(stats.p25)} – ${brl(stats.mediana)}`} detalhe="entre o 1º quartil e a mediana" />
        <Destaque
          rotulo="Desconto médio sobre o estimado"
          valor={stats.descontoMedio === null ? '—' : `${stats.descontoMedio.toFixed(1).replace('.', ',')}%`}
          detalhe="quanto os vencedores ficaram abaixo do valor do órgão"
        />
        <Destaque
          rotulo="Vitórias de ME/EPP"
          valor={stats.participacaoMeEpp === null ? '—' : `${Math.round(stats.participacaoMeEpp * 100)}%`}
          detalhe="entre os resultados com porte informado"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <Painel titulo={`Distribuição dos preços vencedores (por ${unidade})`}>
          <Histograma stats={stats} />
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            Mínimo {brl(stats.minimo, { centavos: true })} · máximo {brl(stats.maximo, { centavos: true })}.
            {stats.descartadasPorUnidade > 0
              ? ` ${stats.descartadasPorUnidade} amostra(s) em outras unidades ficaram fora das estatísticas, mas aparecem na tabela.`
              : ''}{' '}
            Especificações variam entre editais — compare a descrição antes de usar um preço como referência.
          </p>
        </Painel>

        <Painel titulo="Quem mais vence" semPadding>
          <ul className="divide-y divide-ink-100">
            {stats.fornecedores.map((fornecedor, posicao) => (
              <li key={fornecedor.documento || fornecedor.nome} className="flex items-center gap-3 px-5 py-3">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                    posicao === 0 ? 'bg-warn-100 text-warn-700' : 'bg-ink-100 text-ink-600'
                  }`}
                >
                  {posicao === 0 ? <IconTrophy size={15} /> : posicao + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-800" title={fornecedor.nome}>
                    {tituloProprio(fornecedor.nome)}
                  </p>
                  <p className="text-xs text-ink-500">
                    {fornecedor.vitorias} vitória(s) · ticket {brl(fornecedor.ticketMedio)}
                    {fornecedor.documento.length === 14 ? ` · ${cnpjFormatado(fornecedor.documento)}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Painel>
      </div>

      <Painel
        titulo={`Amostras (${amostras.length})`}
        semPadding
        acao={
          <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs font-medium" role="group" aria-label="Ordenar amostras">
            {(
              [
                ['preco', 'Menor preço'],
                ['data', 'Mais recentes'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={ordem === valor}
                onClick={() => setOrdem(valor)}
                className={`rounded-md px-2.5 py-1 transition ${ordem === valor ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500'}`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        }
      >
        <div className="scrollbar-slim relative overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Preços vencedores de “{consulta}”</caption>
            <thead className="bg-ink-50 text-xs text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 text-right font-medium">Vencedor / un.</th>
                <th className="px-4 py-2.5 text-right font-medium">Estimado / un.</th>
                <th className="px-4 py-2.5 text-right font-medium">Desconto</th>
                <th className="px-4 py-2.5 font-medium">Fornecedor</th>
                <th className="px-4 py-2.5 font-medium">Órgão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {tabela.map((amostra) => (
                <tr key={amostra.id} className="align-top">
                  <td className="max-w-xs px-4 py-3">
                    <p className="line-clamp-2 text-ink-800" title={amostra.descricao}>
                      {amostra.descricao}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-500">
                      {amostra.quantidade.toLocaleString('pt-BR')} {amostra.unidade} · {dataLonga(amostra.dataResultado)}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs font-semibold text-ink-900">
                    {brl(amostra.valorHomologadoUnitario, { centavos: true })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-ink-500">
                    {brl(amostra.valorEstimadoUnitario, { centavos: true })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs">
                    {amostra.desconto === null ? '—' : `${amostra.desconto.toFixed(1).replace('.', ',')}%`}
                  </td>
                  <td className="max-w-[200px] px-4 py-3">
                    <p className="truncate text-xs font-medium text-ink-800" title={amostra.fornecedor}>
                      {tituloProprio(amostra.fornecedor)}
                    </p>
                    {amostra.porte ? <p className="text-[11px] text-ink-500">{amostra.porte}</p> : null}
                  </td>
                  <td className="max-w-[220px] px-4 py-3">
                    <a
                      href={amostra.linkPncp}
                      target="_blank"
                      rel="noreferrer"
                      className="group/link inline-flex items-start gap-1 text-xs text-ink-600 hover:text-brand-700"
                    >
                      <span className="line-clamp-2">
                        {tituloProprio(amostra.orgao)} · {amostra.uf}
                      </span>
                      <IconExternal size={12} className="mt-0.5 shrink-0 opacity-50 group-hover/link:opacity-100" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Painel>
    </div>
  );
}

function Destaque({ rotulo, valor, detalhe, forte = false }: { rotulo: string; valor: string; detalhe: string; forte?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 shadow-soft ${forte ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white'}`}>
      <p className={`text-sm ${forte ? 'text-brand-100' : 'text-ink-500'}`}>{rotulo}</p>
      <p className={`mt-2 font-mono text-xl font-semibold tracking-tight ${forte ? 'text-white' : 'text-ink-900'}`}>{valor}</p>
      <p className={`mt-1 text-xs ${forte ? 'text-brand-100' : 'text-ink-500'}`}>{detalhe}</p>
    </div>
  );
}

/** Histograma em SVG: uma série, uma cor, mediana marcada, tooltip por barra. */
function Histograma({ stats }: { stats: EstatisticaPrecos }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const largura = 640;
  const altura = 200;
  const margem = { topo: 16, base: 28, esq: 8, dir: 8 };
  const areaL = largura - margem.esq - margem.dir;
  const areaA = altura - margem.topo - margem.base;
  const maior = Math.max(...stats.faixas.map((faixa) => faixa.quantidade), 1);
  const passo = areaL / stats.faixas.length;
  const gap = 2;
  const escalaX = (valor: number) => {
    const inicio = stats.faixas[0].de;
    const fim = stats.faixas[stats.faixas.length - 1].ate;
    return margem.esq + ((valor - inicio) / (fim - inicio || 1)) * areaL;
  };
  const xMediana = escalaX(stats.mediana);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${largura} ${altura}`} className="h-auto w-full" role="img" aria-label={`Histograma de ${stats.amostras} preços vencedores, mediana ${brl(stats.mediana)}`}>
        <line x1={margem.esq} x2={largura - margem.dir} y1={altura - margem.base} y2={altura - margem.base} stroke="#dee5ef" />
        {stats.faixas.map((faixa, indice) => {
          const h = (faixa.quantidade / maior) * areaA;
          const x = margem.esq + indice * passo + gap / 2;
          const y = altura - margem.base - h;
          const w = Math.max(1, passo - gap);
          const r = Math.min(4, w / 2, h);
          return (
            <g key={indice} onMouseEnter={() => setAtivo(indice)} onMouseLeave={() => setAtivo(null)}>
              {/* Alvo de hover maior que a barra. */}
              <rect x={margem.esq + indice * passo} y={margem.topo} width={passo} height={areaA} fill="transparent" />
              {faixa.quantidade > 0 ? (
                <path
                  d={`M${x},${altura - margem.base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${altura - margem.base} Z`}
                  fill={ativo === indice ? '#2748e3' : '#5f8bff'}
                />
              ) : null}
            </g>
          );
        })}
        <line x1={xMediana} x2={xMediana} y1={margem.topo - 6} y2={altura - margem.base} stroke="#0f172a" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={xMediana} y={margem.topo - 8} textAnchor={xMediana > largura * 0.8 ? 'end' : 'middle'} className="fill-ink-700 text-[11px] font-medium">
          mediana {brl(stats.mediana)}
        </text>
        <text x={margem.esq} y={altura - 8} className="fill-ink-500 text-[11px]">
          {brl(stats.minimo)}
        </text>
        <text x={largura - margem.dir} y={altura - 8} textAnchor="end" className="fill-ink-500 text-[11px]">
          {brl(stats.maximo)}
        </text>
      </svg>
      {ativo !== null ? (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs text-white shadow-lift"
          style={{ left: `${((margem.esq + (ativo + 0.5) * passo) / largura) * 100}%` }}
        >
          <p className="font-mono">
            {brl(stats.faixas[ativo].de)} – {brl(stats.faixas[ativo].ate)}
          </p>
          <p className="text-ink-300">{stats.faixas[ativo].quantidade} vitória(s)</p>
        </div>
      ) : null}
    </div>
  );
}
