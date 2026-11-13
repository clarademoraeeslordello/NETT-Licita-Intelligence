'use client';

import {
  IconAlert,
  IconBuilding,
  IconCheckCircle,
  IconClock,
  IconCurrency,
  IconGavel,
  IconLayers,
  IconList,
  IconShield,
  IconSparkles,
  IconTarget,
  IconTrending,
} from '@/components/icons';
import { DataRow, SourcedList, SourceBadge, StatusChip } from '@/components/data-display';
import type { AnaliseEditais } from '@/lib/schema';
import { evidenceText, isNotFound } from '@/lib/schema';
import { formatDateLabel, prazoRelativo, slugify } from '@/lib/ui-format';

const NIVEL_TONE: Record<string, { chip: string; border: string; bg: string; label: string }> = {
  alto: {
    chip: 'bg-danger-100 text-danger-700',
    border: 'border-l-danger-500',
    bg: 'bg-danger-100/25',
    label: 'Prioridade alta',
  },
  medio: {
    chip: 'bg-warn-100 text-warn-700',
    border: 'border-l-warn-500',
    bg: 'bg-warn-100/20',
    label: 'Prioridade média',
  },
  baixo: {
    chip: 'bg-brand-50 text-brand-700',
    border: 'border-l-brand-400',
    bg: 'bg-brand-50/40',
    label: 'Prioridade baixa',
  },
};

const PRAZO_TONE: Record<string, string> = {
  urgent: 'text-danger-700',
  soon: 'text-warn-700',
  ok: 'text-ok-700',
  past: 'text-ink-500',
  unknown: 'text-ink-500',
};

function Section({
  id,
  number,
  title,
  subtitle,
  children,
}: {
  id: string;
  number: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-ink-200 bg-white p-5 shadow-soft sm:p-7">
      <header className="mb-5 flex items-start gap-4 border-b border-ink-200 pb-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-mono text-sm font-semibold text-brand-700">
          {number}
        </span>
        <div>
          <h2 className="text-xl font-semibold text-ink-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-ink-500">{subtitle}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-ink-500 first:mt-0">{children}</h3>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  icon: (props: { size?: number; className?: string } & React.SVGProps<SVGSVGElement>) => React.ReactElement;
  tone?: 'neutral' | 'urgent' | 'brand' | 'warn';
}) {
  const tones = {
    neutral: 'border-ink-200 bg-white',
    urgent: 'border-danger-100 bg-danger-100/25',
    brand: 'border-brand-100 bg-brand-50/50',
    warn: 'border-warn-100 bg-warn-100/25',
  } as const;

  return (
    <div className={`print-block rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-ink-500">
        <Icon size={15} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <p className="mt-2.5 break-words text-[15px] font-semibold leading-snug text-ink-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

/** Relatório completo em tela — mesma estrutura do PDF gerado. */
export function ReportView({
  analise,
  fileName,
  isDemo,
}: {
  analise: AnaliseEditais;
  fileName: string;
  isDemo: boolean;
}) {
  const info = analise.informacoesGerais;
  const p = analise.participacao;
  const o = analise.obrigacoes;

  const prazoCritico =
    [...analise.cronograma].reverse().find((entry) => /encerramento|limite/i.test(entry.evento)) ??
    analise.cronograma.find((entry) => /abertura|sess[ãa]o/i.test(entry.evento)) ??
    analise.cronograma[0];

  const prazoInfo = prazoCritico ? prazoRelativo(prazoCritico.data) : null;
  const criticos = analise.pontosDeAtencao.filter((point) => point.nivel === 'alto');
  const itens = analise.objeto.itens ?? [];
  const outrosPrazos = analise.outrosPrazos ?? [];
  const cronograma = [...analise.cronograma, ...outrosPrazos];

  const participationGroups: Array<[string, typeof p.quemPodeParticipar]> = [
    ['Quem pode participar', p.quemPodeParticipar],
    ['Habilitação jurídica', p.habilitacaoJuridica],
    ['Habilitação fiscal e trabalhista', p.habilitacaoFiscalTrabalhista],
    ['Qualificação técnica', p.qualificacaoTecnica],
    ['Qualificação econômico-financeira', p.qualificacaoEconomicoFinanceira],
    ['Certidões exigidas', p.certidoes],
    ['Documentos exigidos', p.documentos],
    ['Restrições e impedimentos', p.restricoes],
    ['Exigências específicas', p.exigenciasEspecificas],
    ['Visita técnica ou amostras', p.visitasOuAmostras],
  ];

  return (
    <div className="space-y-5">
      {/* ------------------------ Resumo em destaque ------------------------ */}
      <section className="print-block overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-soft">
        <div className="border-b border-ink-200 bg-gradient-to-br from-brand-50/70 to-white px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600">
                Resumo executivo
              </p>
              <h1 className="mt-2 text-2xl font-semibold leading-tight text-ink-900">
                {isNotFound(info.orgao) ? analise.documento.titulo : evidenceText(info.orgao)}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-600">
                {!isNotFound(info.numeroEdital) ? (
                  <span className="font-medium">Edital {evidenceText(info.numeroEdital)}</span>
                ) : null}
                {!isNotFound(info.modalidade) ? (
                  <>
                    <span className="text-ink-300">·</span>
                    <span>{evidenceText(info.modalidade)}</span>
                  </>
                ) : null}
                <span className="text-ink-300">·</span>
                <span>{analise.documento.paginas ?? 0} páginas analisadas</span>
              </div>
            </div>
            <div className="flex flex-col items-start gap-2">
              {analise.confianca ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-ink-600 shadow-ring">
                  <IconShield size={13} />
                  Confiança {analise.confianca.nivel}
                </span>
              ) : null}
              {isDemo ? (
                <span className="rounded-full bg-warn-100 px-3 py-1.5 text-xs font-semibold text-warn-700">
                  Documento de demonstração
                </span>
              ) : (
                <span className="rounded-full bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-600">
                  Documento enviado
                </span>
              )}
            </div>
          </div>

          <p className="mt-4 max-w-4xl text-[15px] leading-relaxed text-ink-700">
            {primeiraFrase(analise.resumoExecutivo.visaoGeral)}
          </p>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 sm:p-6">
          <KpiCard
            label="Prazo crítico"
            value={prazoCritico ? prazoCritico.data : 'Não identificado'}
            hint={
              prazoCritico ? (
                <span className={PRAZO_TONE[prazoInfo?.tone ?? 'unknown']}>
                  {prazoCritico.evento}
                  {prazoInfo ? ` · ${prazoInfo.label}` : ''}
                </span>
              ) : (
                'Confirme no cronograma oficial'
              )
            }
            icon={IconClock}
            tone={prazoInfo?.tone === 'urgent' ? 'urgent' : 'neutral'}
          />
          <KpiCard
            label="Valor estimado"
            value={evidenceText(analise.valores.valorEstimado)}
            hint={analise.valores.valorEstimado?.source ?? undefined}
            icon={IconCurrency}
            tone={isNotFound(analise.valores.valorEstimado) ? 'neutral' : 'brand'}
          />
          <KpiCard
            label="Órgão"
            value={isNotFound(info.orgao) ? 'Não identificado' : evidenceText(info.orgao)}
            icon={IconBuilding}
          />
          <KpiCard
            label="Modalidade"
            value={isNotFound(info.modalidade) ? 'Não identificado' : evidenceText(info.modalidade)}
            hint={isNotFound(info.criterioJulgamento) ? undefined : evidenceText(info.criterioJulgamento)}
            icon={IconGavel}
          />
          <KpiCard
            label="Itens no objeto"
            value={itens.length ? String(itens.length) : 'Não identificado'}
            hint={analise.objeto.lotes?.length ? `${analise.objeto.lotes.length} lote(s) mencionados` : undefined}
            icon={IconLayers}
          />
          <KpiCard
            label="Pontos de atenção"
            value={`${criticos.length} crítico(s)`}
            hint={`${analise.pontosDeAtencao.length} no total`}
            icon={IconAlert}
            tone={criticos.length ? 'urgent' : 'neutral'}
          />
        </div>

        {analise.resumoExecutivo.alertaPrazo ? (
          <div className="mx-5 mb-6 flex items-start gap-3 rounded-2xl border border-warn-100 bg-warn-100/30 p-4 sm:mx-6">
            <IconAlert size={18} className="mt-0.5 shrink-0 text-warn-700" />
            <p className="text-sm text-warn-700">
              <strong className="font-semibold">Alerta de prazo.</strong> {analise.resumoExecutivo.alertaPrazo}
            </p>
          </div>
        ) : null}
      </section>

      {/* ----------------------------- Seção 1 ----------------------------- */}
      <Section
        id="resumo"
        number="1"
        title="Resumo Executivo"
        subtitle={formatDateLabel(analise.documento.dataAnalise)}
      >
        <p className="text-[15px] leading-relaxed text-ink-700">{analise.resumoExecutivo.visaoGeral}</p>

        {analise.resumoExecutivo.destaques.length ? (
          <>
            <SubTitle>Destaques</SubTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              {analise.resumoExecutivo.destaques.map((item, index) => (
                <div
                  key={`${item.text.slice(0, 30)}-${index}`}
                  className="print-block rounded-xl border border-ink-200 bg-ink-50/50 px-4 py-3"
                >
                  <p className="text-[14.5px] font-medium leading-snug text-ink-800">{item.text}</p>
                  <div className="mt-1.5">
                    <SourceBadge source={item.source} />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <SubTitle>Recomendação</SubTitle>
        <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
          <div className="flex items-start gap-3">
            <IconSparkles size={18} className="mt-0.5 shrink-0 text-brand-600" />
            <p className="text-[14.5px] leading-relaxed text-ink-700">{analise.resumoExecutivo.recomendacao}</p>
          </div>
        </div>

        {analise.confianca ? (
          <p className="mt-4 text-[13px] leading-relaxed text-ink-500">
            <strong className="font-semibold text-ink-700">Confiança da análise ({analise.confianca.nivel}):</strong>{' '}
            {analise.confianca.justificativa}
          </p>
        ) : null}
      </Section>

      {/* ----------------------------- Seção 2 ----------------------------- */}
      <Section
        id="informacoes-gerais"
        number="2"
        title="Informações Gerais"
        subtitle="Cada campo indica se a informação foi encontrada, inferida ou não identificada"
      >
        <dl className="overflow-hidden rounded-2xl border border-ink-200">
          <DataRow label="Órgão / entidade" evidence={info.orgao} />
          <DataRow label="Número do edital" evidence={info.numeroEdital} />
          <DataRow label="Modalidade" evidence={info.modalidade} />
          <DataRow label="Processo" evidence={info.processo} />
          <DataRow label="Portal / plataforma" evidence={info.portal} />
          <DataRow label="Local da disputa" evidence={info.localDisputa} />
          <DataRow label="Critério de julgamento" evidence={info.criterioJulgamento} />
          <DataRow label="Regime de execução" evidence={info.regimeExecucao} />
          <DataRow label="Vigência do contrato" evidence={info.vigenciaContrato} />
          <DataRow label="Objeto (declarado)" evidence={info.objeto} />
        </dl>
      </Section>

      {/* ----------------------------- Seção 3 ----------------------------- */}
      <Section
        id="cronograma"
        number="3"
        title="Cronograma"
        subtitle={
          cronograma.length
            ? `${cronograma.length} marco(s) identificado(s)`
            : 'Nenhuma data identificada automaticamente'
        }
      >
        {cronograma.length ? (
          <>
            <div className="scrollbar-slim -mx-1 overflow-x-auto rounded-2xl border border-ink-200 px-1">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-ink-50 text-[11px] uppercase tracking-[0.08em] text-ink-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Evento</th>
                    <th className="w-32 px-4 py-2.5 font-semibold">Data</th>
                    <th className="hidden w-24 px-4 py-2.5 font-semibold sm:table-cell">Hora</th>
                    <th className="w-40 px-4 py-2.5 font-semibold">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {cronograma.map((entry, index) => {
                    const critical = /encerramento|limite/i.test(entry.evento);
                    const relativo = prazoRelativo(entry.data);
                    return (
                      <tr
                        key={`${entry.evento}-${entry.data}-${index}`}
                        className={`border-t border-ink-100 ${critical ? 'bg-warn-100/25' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <p className={`font-medium ${critical ? 'text-warn-700' : 'text-ink-800'}`}>
                            {critical ? '⏱ ' : ''}
                            {entry.evento}
                          </p>
                          {entry.observacao ? (
                            <p className="mt-0.5 text-xs text-ink-500">{entry.observacao}</p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <p className="font-medium text-ink-900">{entry.data}</p>
                          {relativo ? (
                            <p className={`text-xs ${PRAZO_TONE[relativo.tone]}`}>{relativo.label}</p>
                          ) : null}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-ink-600 sm:table-cell">
                          {entry.hora ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <SourceBadge source={entry.source} />
                            <StatusChip status={entry.status ?? 'found'} compact />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-ink-500">
              Marcos destacados têm consequência direta sobre a participação. Prazos relativos calculados na data desta
              análise.
            </p>
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-4 py-3 text-sm italic text-ink-500">
            Não identificado no documento. Confirme as datas no cronograma oficial publicado pelo órgão.
          </p>
        )}
      </Section>

      {/* ----------------------------- Seção 4 ----------------------------- */}
      <Section
        id="objeto"
        number="4"
        title="Objeto da Licitação"
        subtitle={itens.length ? `${itens.length} item(ns) mapeado(s)` : undefined}
      >
        <p className="text-[15px] leading-relaxed text-ink-800">{analise.objeto.resumo}</p>

        <SubTitle>Descrição detalhada</SubTitle>
        <p className="whitespace-pre-line text-[14.5px] leading-relaxed text-ink-700">
          {analise.objeto.descricaoDetalhada}
        </p>

        {itens.length ? (
          <>
            <SubTitle>Itens identificados</SubTitle>
            <div className="scrollbar-slim -mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-ink-50 text-[11px] uppercase tracking-[0.08em] text-ink-500">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">#</th>
                    <th className="px-3 py-2.5 font-semibold">Descrição</th>
                    <th className="px-3 py-2.5 font-semibold">Qtd.</th>
                    <th className="px-3 py-2.5 font-semibold">Un.</th>
                    <th className="px-3 py-2.5 font-semibold">Lote</th>
                    <th className="px-3 py-2.5 font-semibold">Valor unit.</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((item, index) => (
                    <tr key={`${item.numero}-${index}`} className="border-t border-ink-100 align-top">
                      <td className="px-3 py-3 font-mono text-xs text-ink-500">{item.numero ?? '—'}</td>
                      <td className="px-3 py-3">
                        <p className="text-ink-800">{item.descricao}</p>
                        {item.especificacoes ? (
                          <p className="mt-1 text-xs text-ink-500">{item.especificacoes}</p>
                        ) : null}
                        <div className="mt-1.5">
                          <SourceBadge source={item.source} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-700">{item.quantidade ?? '—'}</td>
                      <td className="px-3 py-3 text-ink-700">{item.unidade ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-700">{item.lote ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-700">{item.valorUnitario ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <SubTitle>Itens identificados</SubTitle>
            <p className="rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-4 py-3 text-sm italic text-ink-500">
              A estrutura de itens não foi identificada automaticamente. Consulte o termo de referência anexo ao
              edital.
            </p>
          </>
        )}

        {analise.objeto.lotes?.length ? (
          <>
            <SubTitle>Lotes / grupos</SubTitle>
            <SourcedList items={analise.objeto.lotes} dense />
          </>
        ) : null}

        {analise.objeto.especificacoesTecnicas?.length ? (
          <>
            <SubTitle>Especificações técnicas relevantes</SubTitle>
            <SourcedList items={analise.objeto.especificacoesTecnicas} dense />
          </>
        ) : null}
      </Section>

      {/* ----------------------------- Seção 5 ----------------------------- */}
      <Section
        id="participacao"
        number="5"
        title="Requisitos para Participação"
        subtitle="Documentos, qualificações e exigências identificadas no edital"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-ink-200 bg-ink-50/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">Consórcio</p>
            <p className="mt-1.5 text-[14.5px] text-ink-800">
              {isNotFound(p.consorcio) ? (
                <span className="italic text-ink-500">Não identificado no documento.</span>
              ) : (
                evidenceText(p.consorcio)
              )}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <StatusChip status={p.consorcio?.status} compact />
              <SourceBadge source={p.consorcio?.source} />
            </div>
          </div>
          <div className="rounded-2xl border border-ink-200 bg-ink-50/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">
              Tratamento diferenciado (ME/EPP)
            </p>
            <p className="mt-1.5 text-[14.5px] text-ink-800">
              {isNotFound(p.meEpp) ? (
                <span className="italic text-ink-500">Não identificado no documento.</span>
              ) : (
                evidenceText(p.meEpp)
              )}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <StatusChip status={p.meEpp?.status} compact />
              <SourceBadge source={p.meEpp?.source} />
            </div>
          </div>
        </div>

        {participationGroups.map(([title, items]) =>
          items && items.length ? (
            <div key={title}>
              <SubTitle>
                {title} <span className="ml-1 text-ink-300">({items.length})</span>
              </SubTitle>
              <SourcedList items={items} dense />
            </div>
          ) : null,
        )}

        {participationGroups.every(([, items]) => !items || items.length === 0) ? (
          <p className="mt-4 rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-4 py-3 text-sm italic text-ink-500">
            Nenhum requisito de participação foi identificado automaticamente. Não identificado no documento.
          </p>
        ) : null}
      </Section>

      {/* ----------------------------- Seção 6 ----------------------------- */}
      <Section id="obrigacoes" number="6" title="Obrigações" subtitle="Principais deveres da empresa vencedora">
        <dl className="overflow-hidden rounded-2xl border border-ink-200">
          <DataRow label="Prazo de execução" evidence={o.prazoExecucao} />
          <DataRow label="Prazo de entrega" evidence={o.prazoEntrega} />
          <DataRow label="Subcontratação" evidence={o.subcontratacao} />
        </dl>

        <SubTitle>Obrigações da contratada</SubTitle>
        <SourcedList
          items={o.contratada}
          emptyLabel="Nenhuma obrigação da contratada foi identificada automaticamente."
          dense
        />

        <SubTitle>Obrigações da contratante</SubTitle>
        <SourcedList
          items={o.contratante}
          emptyLabel="Nenhuma obrigação da contratante foi identificada automaticamente."
          dense
        />

        <SubTitle>Condições de pagamento</SubTitle>
        <SourcedList
          items={o.condicoesPagamento}
          emptyLabel="Condições de pagamento não identificadas automaticamente."
          dense
        />

        <SubTitle>Garantias</SubTitle>
        <SourcedList items={o.garantias} emptyLabel="Nenhuma garantia exigida foi identificada automaticamente." dense />

        <SubTitle>Penalidades e sanções</SubTitle>
        <SourcedList
          items={o.penalidades?.length ? o.penalidades : o.sancoes}
          emptyLabel="Nenhuma penalidade foi identificada automaticamente."
          dense
        />
      </Section>

      {/* ----------------------------- Seção 7 ----------------------------- */}
      <Section id="valores" number="7" title="Valores" subtitle="Informações financeiras encontradas no edital">
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard
            label="Valor estimado"
            value={evidenceText(analise.valores.valorEstimado)}
            hint={analise.valores.valorEstimado?.source ?? undefined}
            icon={IconCurrency}
            tone={isNotFound(analise.valores.valorEstimado) ? 'neutral' : 'brand'}
          />
          <KpiCard
            label="Valor máximo"
            value={evidenceText(analise.valores.valorMaximo)}
            hint={analise.valores.valorMaximo?.source ?? undefined}
            icon={IconTrending}
          />
          <KpiCard
            label="Moeda"
            value={analise.valores.moeda ?? 'BRL'}
            hint="Valores como publicados no edital"
            icon={IconShield}
          />
        </div>

        {analise.valores.valorEstimado?.quote ? (
          <blockquote className="mt-4 border-l-2 border-ink-200 bg-ink-50/70 px-4 py-3 text-[13.5px] italic leading-relaxed text-ink-600">
            “{analise.valores.valorEstimado.quote}”
          </blockquote>
        ) : null}

        {analise.valores.itens?.length ? (
          <>
            <SubTitle>Valores por item / lote</SubTitle>
            <div className="scrollbar-slim -mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-ink-50 text-[11px] uppercase tracking-[0.08em] text-ink-500">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">#</th>
                    <th className="px-3 py-2.5 font-semibold">Descrição</th>
                    <th className="px-3 py-2.5 font-semibold">Qtd.</th>
                    <th className="px-3 py-2.5 font-semibold">Valor unit.</th>
                    <th className="px-3 py-2.5 font-semibold">Valor total</th>
                  </tr>
                </thead>
                <tbody>
                  {analise.valores.itens.map((item, index) => (
                    <tr key={`${item.numero}-${index}`} className="border-t border-ink-100">
                      <td className="px-3 py-2.5 font-mono text-xs text-ink-500">{item.numero ?? '—'}</td>
                      <td className="px-3 py-2.5 text-ink-800">{item.descricao}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-700">{item.quantidade ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-700">{item.valorUnitario ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-700">{item.valorTotal ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-4 py-3 text-sm text-ink-500">
            A planilha orçamentária detalhada não foi localizada no texto analisado — os valores por item podem estar em
            anexo separado.
          </p>
        )}

        {analise.valores.observacoes?.length ? (
          <>
            <SubTitle>Observações financeiras</SubTitle>
            <SourcedList items={analise.valores.observacoes} dense />
          </>
        ) : null}
      </Section>

      {/* ----------------------------- Seção 8 ----------------------------- */}
      <Section
        id="pontos-de-atencao"
        number="8"
        title="Pontos de Atenção"
        subtitle="Priorizados por impacto potencial sobre a participação"
      >
        {analise.pontosDeAtencao.length ? (
          <div className="space-y-3">
            {[...analise.pontosDeAtencao]
              .sort(
                (a, b) =>
                  ['alto', 'medio', 'baixo'].indexOf(a.nivel) - ['alto', 'medio', 'baixo'].indexOf(b.nivel),
              )
              .map((point, index) => {
                const tone = NIVEL_TONE[point.nivel] ?? NIVEL_TONE.medio;
                return (
                  <article
                    key={`${point.titulo}-${index}`}
                    className={`print-block rounded-2xl border border-ink-200 border-l-4 p-4 ${tone.border} ${tone.bg}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${tone.chip}`}>
                        {tone.label}
                      </span>
                      <h3 className="min-w-0 flex-1 text-[15px] font-semibold text-ink-900">{point.titulo}</h3>
                      <SourceBadge source={point.source} />
                    </div>
                    <p className="mt-2 text-[14.5px] leading-relaxed text-ink-700">{point.motivo}</p>
                    {point.trecho ? (
                      <blockquote className="mt-2.5 border-l-2 border-ink-300 bg-white/70 px-3 py-2 text-[13px] italic leading-relaxed text-ink-600">
                        “{point.trecho}”
                      </blockquote>
                    ) : null}
                    {point.recomendacao ? (
                      <p className="mt-2.5 text-[14px] leading-relaxed text-ink-700">
                        <strong className="font-semibold text-ink-900">Ação recomendada:</strong> {point.recomendacao}
                      </p>
                    ) : null}
                  </article>
                );
              })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-4 py-3 text-sm italic text-ink-500">
            Nenhum ponto de atenção específico foi identificado automaticamente. Isso não significa ausência de risco:
            recomenda-se leitura humana das cláusulas de habilitação, penalidades e prazos.
          </p>
        )}
      </Section>

      {/* ----------------------------- Seção 9 ----------------------------- */}
      <Section
        id="checklist"
        number="9"
        title="Checklist de Participação"
        subtitle={
          analise.checklist.length
            ? `${analise.checklist.filter((entry) => entry.obrigatorio !== false).length} item(ns) obrigatório(s)`
            : undefined
        }
      >
        {analise.checklist.length ? (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {analise.checklist.map((entry, index) => (
                <li
                  key={`${entry.item.slice(0, 40)}-${index}`}
                  className="print-block flex items-start gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3"
                >
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${
                      entry.obrigatorio === false
                        ? 'border-dashed border-ink-300 bg-white'
                        : 'border-ok-500 bg-ok-500 text-white'
                    }`}
                    aria-hidden="true"
                  >
                    {entry.obrigatorio === false ? null : <IconCheckCircle size={13} />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-medium leading-snug text-ink-800">{entry.item}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                          entry.obrigatorio === false ? 'bg-ink-100 text-ink-500' : 'bg-ok-100 text-ok-700'
                        }`}
                      >
                        {entry.obrigatorio === false ? 'Desejável' : 'Obrigatório'}
                      </span>
                      <SourceBadge source={entry.source} />
                    </div>
                    {entry.observacao ? (
                      <p className="mt-1 text-xs text-ink-500">{entry.observacao}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-500">
              Checklist gerado a partir das exigências localizadas no documento. Confronte com a leitura integral do
              edital.
            </p>
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-4 py-3 text-sm italic text-ink-500">
            Não foi possível montar o checklist automaticamente a partir deste documento. Não identificado no documento.
          </p>
        )}
      </Section>

      {/* ----------------------------- Seção 10 ---------------------------- */}
      <Section id="conclusao" number="10" title="Conclusão" subtitle="Resumo objetivo da análise">
        <p className="text-[15px] leading-relaxed text-ink-800">{analise.conclusao.texto}</p>

        <SubTitle>Próximos passos sugeridos</SubTitle>
        <SourcedList items={analise.conclusao.proximosPassos} emptyLabel="Nenhum próximo passo foi gerado." dense />

        <SubTitle>Limitações desta análise</SubTitle>
        <ul className="space-y-2">
          {analise.conclusao.limitacoesDaAnalise.map((limitation, index) => (
            <li
              key={`${limitation.slice(0, 30)}-${index}`}
              className="flex items-start gap-3 rounded-xl border border-ink-200 bg-ink-50/50 px-4 py-3"
            >
              <IconList size={16} className="mt-0.5 shrink-0 text-ink-500" />
              <span className="text-[14px] leading-relaxed text-ink-600">{limitation}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
          <IconGavel size={18} className="mt-0.5 shrink-0 text-ink-500" />
          <p className="text-[13px] leading-relaxed text-ink-500">
            Esta análise é um apoio à decisão gerado automaticamente. Não constitui parecer jurídico e não substitui a
            leitura integral do edital nem a validação por profissional habilitado. O sistema não declara que uma
            empresa pode ou não participar.
          </p>
        </div>
      </Section>

      <p className="pb-4 text-center text-xs text-ink-500">
        Arquivo analisado: <span className="font-mono">{fileName}</span> ·{' '}
        <span className="font-mono">#{slugify(fileName, 12)}</span>
      </p>
    </div>
  );
}



/**
 * Primeira frase de um texto — usada no cabeçalho do relatório para não repetir
 * o resumo executivo inteiro na seção 1 (que já o apresenta na íntegra).
 */
function primeiraFrase(texto: string): string {
  const match = /^(.{40,320}?[.!?])(?:\s|$)/.exec(texto.trim());
  return match ? match[1] : texto;
}
