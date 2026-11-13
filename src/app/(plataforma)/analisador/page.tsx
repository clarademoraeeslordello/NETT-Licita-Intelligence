import type { Metadata } from 'next';
import { AnalyzeWorkspace } from '@/components/analyze-workspace';
import {
  IconAlert,
  IconBuilding,
  IconCheckCircle,
  IconClock,
  IconCode,
  IconCurrency,
  IconDocument,
  IconGavel,
  IconLayers,
  IconList,
  IconShield,
  IconSparkles,
  IconTarget,
} from '@/components/icons';
import { getCapabilities } from '@/lib/capabilities';

export const metadata: Metadata = {
  title: 'Análise de editais de licitação com IA',
  description:
    'Envie um edital em PDF e receba um relatório executivo com prazos, valores, exigências de habilitação, obrigações, pontos de atenção e checklist de participação.',
};

export const dynamic = 'force-dynamic';

const PIPELINE = [
  {
    title: 'Documento recebido',
    detail: 'Validação de formato, tamanho e assinatura do PDF.',
    icon: IconDocument,
  },
  {
    title: 'Extraindo conteúdo',
    detail: 'Leitura página a página, preservando a paginação original.',
    icon: IconLayers,
  },
  {
    title: 'Analisando edital',
    detail: 'IA lê o documento inteiro — em blocos quando ele é extenso.',
    icon: IconSparkles,
  },
  {
    title: 'Estruturando informações',
    detail: 'Resposta validada por schema estrito, com origem e nível de confiança.',
    icon: IconShield,
  },
  {
    title: 'Gerando relatório',
    detail: 'Relatório executivo em tela e em PDF profissional A4.',
    icon: IconCode,
  },
];

const EXTRACTED = [
  {
    title: 'Identificação',
    detail: 'Órgão, número do edital, modalidade, processo e objeto.',
    icon: IconBuilding,
  },
  { title: 'Cronograma', detail: 'Publicação, propostas, abertura, sessão pública e demais prazos.', icon: IconClock },
  { title: 'Valores', detail: 'Valor estimado, valor máximo e valores por item/lote.', icon: IconCurrency },
  {
    title: 'Habilitação',
    detail: 'Documentos, certidões, qualificação técnica e econômico-financeira.',
    icon: IconShield,
  },
  { title: 'Objeto', detail: 'Produtos, serviços, quantidades, unidades, lotes e especificações.', icon: IconTarget },
  { title: 'Obrigações', detail: 'Contratada, contratante, prazos, pagamento, garantias e penalidades.', icon: IconGavel },
  {
    title: 'Pontos de atenção',
    detail: 'Cláusulas de risco explicadas objetivamente e priorizadas.',
    icon: IconAlert,
  },
  { title: 'Checklist', detail: 'Lista de preparação para a participação, com origem de cada exigência.', icon: IconList },
];

const GUARANTEES = [
  {
    title: 'Zero invenção de dados',
    detail:
      'Cada campo carrega um status: encontrado no edital, inferido ou não identificado. Sem informação, o relatório escreve exatamente "Não identificado no documento."',
    icon: IconCheckCircle,
  },
  {
    title: 'Rastreabilidade por página',
    detail:
      'As informações relevantes vêm acompanhadas do trecho literal e da página de origem, para conferência imediata no PDF original.',
    icon: IconLayers,
  },
  {
    title: 'Apoio à decisão, não parecer jurídico',
    detail:
      'O sistema nunca afirma se uma empresa pode ou não participar com segurança jurídica. Ele organiza o edital e aponta o que exige validação humana.',
    icon: IconGavel,
  },
  {
    title: 'Documentos longos sem corte cego',
    detail:
      'Editais extensos são lidos em blocos de páginas e consolidados em uma síntese final, em vez de sofrerem corte arbitrário de texto.',
    icon: IconLayers,
  },
];

type PageProps = { searchParams: Promise<{ pncp?: string }> };

/** `?pncp={cnpj}/{ano}/{sequencial}` — análise disparada a partir do Radar. */
function lerOrigemPncp(valor: string | undefined) {
  const partes = /^(\d{14})\/(\d{4})\/(\d{1,7})$/.exec(valor ?? '');
  return partes ? { cnpj: partes[1], ano: partes[2], seq: partes[3] } : null;
}

export default async function AnalisadorPage({ searchParams }: PageProps) {
  const capabilities = await getCapabilities();
  const origemPncp = lerOrigemPncp((await searchParams).pncp);

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8 lg:-my-8">

      {/* -------------------------------- Hero -------------------------------- */}
      <section className="relative overflow-hidden border-b border-ink-200 bg-white">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-70" />
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, #bfd3ff, transparent)' }}
        />
        <div className="relative mx-auto max-w-6xl px-5 py-14 lg:py-20">
          <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="animate-[fade-up_0.5s_ease-out_both]">
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700">
                <IconSparkles size={14} />
                Análise de licitações com IA · Lei 14.133/2021
              </span>

              <h1 className="text-balance mt-6 text-4xl font-semibold leading-[1.1] text-ink-900 sm:text-5xl">
                Leia um edital inteiro em minutos, não em horas.
              </h1>

              <p className="text-pretty mt-5 max-w-xl text-lg leading-relaxed text-ink-600">
                Envie o PDF do edital e receba um relatório executivo estruturado: prazos críticos, valores,
                exigências de habilitação, obrigações, pontos de atenção priorizados e checklist de participação —
                cada informação ancorada na página de onde saiu.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-ink-600">
                <span className="inline-flex items-center gap-2">
                  <IconCheckCircle size={16} className="text-ok-500" />
                  Extração estruturada com validação de schema
                </span>
                <span className="inline-flex items-center gap-2">
                  <IconCheckCircle size={16} className="text-ok-500" />
                  Relatório em PDF pronto para o cliente
                </span>
                <span className="inline-flex items-center gap-2">
                  <IconCheckCircle size={16} className="text-ok-500" />
                  Sem informação inventada
                </span>
              </div>

              <div className="mt-8 grid max-w-lg grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { value: '5', label: 'etapas no pipeline' },
                  { value: `${capabilities.limits.maxUploadMb} MB`, label: 'limite por PDF' },
                  { value: 'A4', label: 'relatório em PDF' },
                  { value: capabilities.ai.configured ? 'IA' : 'Local', label: 'motor de análise' },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-ink-200 bg-white/80 px-4 py-3">
                    <p className="font-mono text-lg font-semibold text-ink-900">{item.value}</p>
                    <p className="text-xs text-ink-500">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="animate-[fade-up_0.55s_ease-out_both] lg:pt-2">
              <AnalyzeWorkspace capabilities={capabilities} origemPncp={origemPncp} />

              {!capabilities.ai.configured && !capabilities.degraded ? (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-warn-100 bg-warn-100/40 p-4 text-sm text-warn-700">
                  <IconAlert size={18} className="mt-0.5 shrink-0" />
                  <p>
                    <strong>Modo demonstração local ativo.</strong> Sem <code className="font-mono">DEEPSEEK_API_KEY</code>{' '}
                    configurada, a análise é feita pelo motor determinístico de extração embutido. Configure a chave no
                    arquivo <code className="font-mono">.env</code> para habilitar a análise completa por IA.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------- Pipeline ------------------------------ */}
      <section id="como-funciona" className="mx-auto max-w-6xl px-5 py-16">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Pipeline</p>
          <h2 className="mt-3 text-3xl font-semibold text-ink-900">Do PDF bruto ao relatório executivo</h2>
          <p className="mt-3 text-ink-600">
            Cada etapa é visível para o usuário. Nenhuma informação chega ao relatório sem passar por validação de
            schema.
          </p>
        </div>

        <ol className="mt-10 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          {PIPELINE.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="group relative rounded-2xl border border-ink-200 bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift"
              >
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-100">
                    <Icon size={20} />
                  </span>
                  <span className="font-mono text-xs text-ink-300">0{index + 1}</span>
                </div>
                <p className="mt-4 font-medium text-ink-900">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-500">{step.detail}</p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* -------------------------- O que é extraído ------------------------- */}
      <section id="o-que-e-extraido" className="border-y border-ink-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Escopo da análise</p>
            <h2 className="mt-3 text-3xl font-semibold text-ink-900">O que a análise entrega</h2>
            <p className="mt-3 text-ink-600">
              Oito blocos de informação organizados no mesmo padrão de qualidade, com página de origem sempre que
              disponível.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {EXTRACTED.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-2xl border border-ink-200 bg-ink-50/60 p-5 transition hover:border-ink-300 hover:bg-white"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-white text-ink-700 shadow-ring">
                    <Icon size={19} />
                  </span>
                  <p className="mt-4 font-medium text-ink-900">{item.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-500">{item.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* --------------------------- Confiabilidade -------------------------- */}
      <section id="confiabilidade" className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Confiabilidade</p>
            <h2 className="mt-3 text-3xl font-semibold text-ink-900">
              Um analisador que sabe dizer “não sei”
            </h2>
            <p className="mt-4 leading-relaxed text-ink-600">
              A parte mais difícil de automatizar um documento jurídico não é extrair texto: é não inventar. O
              Analisador Inteligente de Editais trata ausência, ambiguidade e inferência como estados explícitos do
              modelo de dados — e isso aparece no relatório.
            </p>

            <div className="mt-6 rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
              <p className="text-sm font-medium text-ink-900">Estados possíveis de cada informação</p>
              <ul className="mt-4 space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-full bg-ok-100 px-2.5 py-1 text-xs font-semibold text-ok-700">
                    Encontrado
                  </span>
                  <span className="text-ink-600">
                    Localizado literalmente no edital, com trecho e página de origem.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-full bg-warn-100 px-2.5 py-1 text-xs font-semibold text-warn-700">
                    Inferido
                  </span>
                  <span className="text-ink-600">
                    Deduzido do contexto — vem sempre acompanhado da justificativa da dedução.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-600">
                    Não identificado
                  </span>
                  <span className="text-ink-600">
                    O documento não traz a informação. O relatório escreve exatamente “Não identificado no documento.”
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {GUARANTEES.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <Icon size={19} />
                  </span>
                  <p className="mt-4 font-medium text-ink-900">{item.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{item.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------ Relatório ---------------------------- */}
      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-10 lg:grid-cols-[1fr_0.85fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Relatório</p>
              <h2 className="mt-3 text-3xl font-semibold text-ink-900">
                Um documento que você entregaria ao cliente
              </h2>
              <p className="mt-4 leading-relaxed text-ink-600">
                O relatório sai em tela e em PDF A4 com capa, dez seções numeradas, tabelas, badges de status,
                priorização dos pontos de atenção e checklist de participação.
              </p>
              <ol className="mt-6 grid gap-2 text-sm text-ink-600 sm:grid-cols-2">
                {[
                  'Capa com identificação do certame',
                  '1. Resumo executivo',
                  '2. Informações gerais',
                  '3. Cronograma',
                  '4. Objeto da licitação',
                  '5. Requisitos para participação',
                  '6. Obrigações',
                  '7. Valores',
                  '8. Pontos de atenção',
                  '9. Checklist',
                  '10. Conclusão',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <IconCheckCircle size={15} className="shrink-0 text-ok-500" />
                    {item}
                  </li>
                ))}
              </ol>
            </div>

            <div className="relative">
              <div className="rounded-2xl border border-ink-200 bg-ink-50 p-3 shadow-lift">
                <div className="rounded-xl border border-ink-200 bg-white p-5">
                  <div className="flex items-center justify-between border-b border-ink-200 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 items-center justify-center rounded-lg bg-ink-900 text-[10px] font-semibold text-white">
                        AI
                      </span>
                      <span className="text-xs font-medium text-ink-800">Relatório de análise</span>
                    </div>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                      PDF · A4
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    <div className="h-2.5 w-3/4 rounded-full bg-ink-200" />
                    <div className="h-2 w-full rounded-full bg-ink-100" />
                    <div className="h-2 w-5/6 rounded-full bg-ink-100" />
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {['Prazo', 'Valor', 'Itens'].map((label) => (
                        <div key={label} className="rounded-lg border border-ink-200 bg-ink-50 p-2.5">
                          <p className="text-[9px] uppercase tracking-wider text-ink-500">{label}</p>
                          <div className="mt-1.5 h-2 w-full rounded-full bg-ink-200" />
                        </div>
                      ))}
                    </div>
                    {['alto', 'medio', 'baixo'].map((nivel) => (
                      <div
                        key={nivel}
                        className={`rounded-lg border-l-4 bg-ink-50 p-2.5 ${
                          nivel === 'alto'
                            ? 'border-danger-500'
                            : nivel === 'medio'
                              ? 'border-warn-500'
                              : 'border-brand-400'
                        }`}
                      >
                        <div className="h-2 w-2/5 rounded-full bg-ink-300" />
                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-ink-200" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-ink-500">Prévia ilustrativa do relatório gerado</p>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------- CTA -------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="relative overflow-hidden rounded-3xl bg-ink-900 px-8 py-12 text-center text-white">
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{ background: 'radial-gradient(600px 200px at 50% 0%, #2748e3, transparent)' }}
          />
          <div className="relative">
            <h2 className="text-3xl font-semibold">Quer ver funcionando com um edital real?</h2>
            <p className="mx-auto mt-4 max-w-2xl text-ink-200">
              Use o edital de demonstração incluído no projeto e acompanhe o pipeline completo: extração, análise,
              estruturação e relatório em PDF.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#enviar-edital"
                className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-ink-900 transition hover:bg-ink-100"
              >
                Enviar meu edital
              </a>
              <a
                href="/api/demo/edital?download=1"
                className="rounded-xl border border-white/25 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Baixar o edital de demonstração
              </a>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
