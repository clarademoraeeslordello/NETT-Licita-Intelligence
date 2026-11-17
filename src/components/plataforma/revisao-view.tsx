'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { IconAlert, IconCheckCircle, IconExternal, IconSparkles } from '@/components/icons';
import type { FitAssessmentResult } from '@/contracts';
import type { AnaliseEditais } from '@/lib/schema';
import { dataHora, tituloProprio } from '@/lib/plataforma/formato';
import type { DadosRevisao } from '@/app/(plataforma)/revisao/[id]/dados';
import { chamarApi, mensagemDeErro } from './api-v1';
import { DecisaoParticipacaoForm, type ParecerRegistrado } from './decisao-participacao';
import {
  blocosEvidencia,
  corpoDaRevisao,
  montarCorrecao,
  resolverDecisao,
  ROTULO_DECISAO,
  ROTULO_EVIDENCIA,
  ROTULO_EVIDENCIA_FIT,
  ROTULO_NIVEL,
  ROTULO_RECOMENDACAO,
  ROTULO_SITUACAO_REQUISITO,
  ROTULO_STATUS,
  type BlocoEvidencia,
} from './revisao-logica';
import { Aviso, botaoPrimario, botaoSecundario, PageHeader, Painel } from './ui';

const CHIP = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold';
const ESTILO_STATUS = {
  pending_review: 'bg-nett-gold-dark/30 text-nett-gold-light',
  approved: 'bg-nett-gold/20 text-nett-gold-light',
  approved_with_changes: 'bg-nett-gold/20 text-nett-gold-light',
  rejected: 'bg-nett-text/10 text-nett-text',
  superseded: 'bg-nett-raised text-nett-text-muted',
} as const;
const KIND = { tender_summary: 'Resumo do edital', fit_assessment: 'Aderência × habilitação', risk_review: 'Revisão de riscos' } as const;

export function RevisaoView({ dados, podeEscrever }: { dados: DadosRevisao; podeEscrever: boolean }) {
  const { analise, oportunidade: op } = dados;
  const router = useRouter();
  const [edicoes, setEdicoes] = useState<Record<string, { texto: string; nota: string }>>({});
  const [escolha, setEscolha] = useState<'approve' | 'reject'>('approve');
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [parecerParticipacao, setParecerParticipacao] = useState<ParecerRegistrado | null>(dados.decisaoParticipacao);

  const blocos = useMemo(() => (analise.kind === 'tender_summary' ? blocosEvidencia(dados.resultado) : []), [analise.kind, dados.resultado]);
  const correcoes = useMemo(
    () => blocos.flatMap((b) => { const e = edicoes[b.path]; const c = e ? montarCorrecao(b, e.texto, e.nota) : null; return c ? [c] : []; }),
    [blocos, edicoes],
  );

  const revisavel = analise.status === 'succeeded' && dados.resultado !== null && analise.kind !== 'risk_review' && analise.statusRevisao !== 'superseded';
  const painel = resolverDecisao(escolha, correcoes.length, comentario);

  const enviar = async () => {
    setEnviando(true);
    setErro(null);
    setFeito(null);
    try {
      const r = await chamarApi<{ review: { decision: keyof typeof ROTULO_DECISAO } }>(`/companies/${dados.empresaId}/reviews`, {
        method: 'POST',
        corpo: corpoDaRevisao(analise.id, escolha, correcoes, comentario),
      });
      setFeito(`Parecer registrado: ${ROTULO_DECISAO[r.review.decision].toLowerCase()}.`);
      setEdicoes({});
      setComentario('');
      router.refresh();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Revisão humana"
        titulo="Revisão da análise"
        descricao={
          <>
            {KIND[analise.kind]} · {tituloProprio(op.agencyName)}
            {op.uf ? ` · ${op.uf}` : ''} — {op.title}
          </>
        }
        acoes={
          <>
            <Link href="/pipeline" className={botaoSecundario}>
              Voltar ao pipeline
            </Link>
            <a href={op.url} target="_blank" rel="noreferrer" className={botaoSecundario}>
              <IconExternal size={15} /> Portal de origem
            </a>
          </>
        }
      />

      <div className="mb-5">
        <Aviso tom="info" titulo="A IA extrai e sinaliza; a decisão é da equipe.">
          Confira cada informação contra o trecho e a página do edital. Corrija o que estiver errado e registre o parecer: ele fica gravado com data e responsável e não pode ser apagado.
        </Aviso>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Painel titulo="Origem da análise">
            <dl className="grid gap-4 text-sm sm:grid-cols-4">
              <Item rotulo="Situação da revisão">
                <span className={`${CHIP} ${ESTILO_STATUS[analise.statusRevisao]}`}>{ROTULO_STATUS[analise.statusRevisao]}</span>
              </Item>
              <Item rotulo="Gerada por">{analise.engine === 'llm' ? `IA${analise.model ? ` (${analise.model})` : ''}` : analise.engine === 'local_rules' ? 'Regras locais' : '—'}</Item>
              <Item rotulo="Confiança">{analise.confidence ? ROTULO_NIVEL[analise.confidence] : '—'}</Item>
              <Item rotulo="Concluída em">{dataHora(analise.finishedAt)}</Item>
            </dl>
            {analise.publica ? <p className="mt-3 text-xs text-nett-text-muted">Análise compartilhada (só documentos públicos). O parecer vale apenas para a sua empresa.</p> : null}
            {analise.warnings.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-nett-gold-light">
                {analise.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <IconAlert size={14} /> <span>{w}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Painel>

          {analise.status !== 'succeeded' ? (
            <Aviso tom="warn" titulo="Esta análise ainda não foi concluída.">
              Só análises concluídas podem ser revisadas.
            </Aviso>
          ) : dados.erroResultado ? (
            <Aviso tom="danger" titulo="Resultado indisponível para revisão.">
              {dados.erroResultado}
            </Aviso>
          ) : analise.kind === 'risk_review' ? (
            <Aviso tom="warn" titulo="Este tipo de análise ainda não tem formato definido.">A revisão da análise de riscos será liberada quando o formato do resultado for fechado.</Aviso>
          ) : analise.kind === 'tender_summary' ? (
            <ResumoEdital resultado={dados.resultado as AnaliseEditais} blocos={blocos} edicoes={edicoes} editavel={revisavel && podeEscrever} onEditar={(path, v) => setEdicoes((e) => ({ ...e, [path]: { texto: v.texto, nota: v.nota } }))} />
          ) : (
            <Aderencia r={dados.resultado as FitAssessmentResult} />
          )}
        </div>

        <aside className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:self-start">
          <Painel titulo="Seu parecer sobre a análise">
            {!podeEscrever ? (
              <p className="text-sm text-nett-text-muted">Seu papel é de leitura: só consultores registram pareceres.</p>
            ) : !revisavel ? (
              <p className="text-sm text-nett-text-muted">{analise.statusRevisao === 'superseded' ? 'Há uma análise mais recente; revise a mais nova.' : 'Esta análise não pode ser revisada agora.'}</p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Decisão">
                  {(
                    [
                      ['approve', correcoes.length > 0 ? `Aprovar com ${correcoes.length} ajuste${correcoes.length > 1 ? 's' : ''}` : 'Aprovar'],
                      ['reject', 'Rejeitar'],
                    ] as const
                  ).map(([valor, rotulo]) => (
                    <button
                      key={valor}
                      type="button"
                      aria-pressed={escolha === valor}
                      onClick={() => setEscolha(valor)}
                      className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${escolha === valor ? 'border-nett-gold bg-nett-gold/20 text-nett-gold-light' : 'border-nett-text-muted/15 text-nett-text hover:bg-nett-black'}`}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
                {escolha === 'reject' && correcoes.length > 0 ? <p className="text-xs text-nett-text-muted">As {correcoes.length} correção(ões) não serão gravadas ao rejeitar.</p> : null}
                <label className="block">
                  <span className="text-xs font-medium text-nett-text">Comentário{escolha === 'reject' ? ' (obrigatório)' : ''}</span>
                  <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={3} maxLength={5000} className="mt-1 w-full resize-y rounded-xl border border-nett-text-muted/15 px-3 py-2 text-sm" />
                </label>
                {erro ? (
                  <p role="alert" className="flex items-start gap-1.5 text-sm text-nett-gold-light">
                    <IconAlert size={15} /> <span>{erro}</span>
                  </p>
                ) : null}
                {feito ? (
                  <p role="status" className="flex items-start gap-1.5 text-sm text-nett-gold-light">
                    <IconCheckCircle size={15} /> <span>{feito}</span>
                  </p>
                ) : null}
                {!painel.podeEnviar && painel.motivo ? <p className="text-xs text-nett-text-muted">{painel.motivo}</p> : null}
                <button type="button" onClick={() => void enviar()} disabled={enviando || !painel.podeEnviar} className={`${botaoPrimario} w-full`}>
                  {enviando ? 'Registrando…' : 'Registrar parecer'}
                </button>
              </div>
            )}
          </Painel>

          <DecisaoParticipacaoForm companyId={dados.empresaId} opportunityId={op.id} atual={parecerParticipacao} podeEscrever={podeEscrever} onRegistrado={setParecerParticipacao} />

          <Painel titulo="Histórico de pareceres">
            {dados.pareceres.length === 0 ? (
              <p className="text-sm text-nett-text-muted">Nenhum parecer registrado para esta análise.</p>
            ) : (
              <ul className="space-y-3">
                {dados.pareceres.map((p) => (
                  <li key={p.id} className="text-sm">
                    <p className="font-medium text-nett-text">
                      {p.revisor} · {ROTULO_DECISAO[p.decision].toLowerCase()}
                      {p.correcoes > 0 ? ` (${p.correcoes} correç${p.correcoes > 1 ? 'ões' : 'ão'})` : ''}
                    </p>
                    <p className="text-xs text-nett-text-muted">{dataHora(p.criadoEm)}</p>
                    {p.comment ? <p className="mt-1 whitespace-pre-wrap text-xs text-nett-text-muted">{p.comment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Painel>
        </aside>
      </div>
    </>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-nett-text-muted">{rotulo}</dt>
      <dd className="mt-0.5 text-nett-text">{children}</dd>
    </div>
  );
}

/* ------------------------------- tender_summary ------------------------------- */

function ResumoEdital({
  resultado,
  blocos,
  edicoes,
  editavel,
  onEditar,
}: {
  resultado: AnaliseEditais;
  blocos: BlocoEvidencia[];
  edicoes: Record<string, { texto: string; nota: string }>;
  editavel: boolean;
  onEditar: (path: string, v: { texto: string; nota: string }) => void;
}) {
  return (
    <>
      <Painel titulo="Resumo executivo">
        <p className="text-sm leading-relaxed text-nett-text">{resultado.resumoExecutivo.visaoGeral}</p>
        {resultado.resumoExecutivo.alertaPrazo ? <p className="mt-2 text-sm text-nett-gold-light">Prazo: {resultado.resumoExecutivo.alertaPrazo}</p> : null}
        <p className="mt-3 text-xs text-nett-text-muted">
          Recomendação do modelo (não é decisão): <span className="text-nett-text">{resultado.resumoExecutivo.recomendacao}</span>
        </p>
      </Painel>

      <Painel titulo="Informações com evidência" semPadding>
        <ul className="divide-y divide-nett-text-muted/10">
          {blocos.map((b) => (
            <CampoEvidencia key={b.path} bloco={b} edicao={edicoes[b.path]} editavel={editavel} onEditar={(v) => onEditar(b.path, v)} />
          ))}
          {blocos.length === 0 ? <li className="px-5 py-4 text-sm text-nett-text-muted">Nenhum campo com evidência neste resultado.</li> : null}
        </ul>
      </Painel>

      {resultado.pontosDeAtencao.length > 0 ? (
        <Painel titulo={`Pontos de atenção (${resultado.pontosDeAtencao.length})`} semPadding>
          <ul className="divide-y divide-nett-text-muted/10">
            {resultado.pontosDeAtencao.map((p, i) => (
              <li key={i} className="px-5 py-4 text-sm">
                <p className="font-medium text-nett-text">
                  {p.titulo} <span className={`${CHIP} ml-1 ${p.nivel === 'alto' ? 'bg-nett-gold-light/20 text-nett-gold-light' : 'bg-nett-raised text-nett-text-muted'}`}>nível {p.nivel}</span>
                </p>
                <p className="mt-1 text-nett-text-muted">{p.motivo}</p>
                {p.trecho ? <blockquote className="mt-2 border-l-2 border-nett-gold-dark pl-3 text-xs text-nett-text-muted">“{p.trecho}”{p.source ? ` — ${p.source}` : ''}</blockquote> : null}
              </li>
            ))}
          </ul>
        </Painel>
      ) : null}

      {resultado.conclusao.limitacoesDaAnalise.length > 0 ? (
        <Painel titulo="Limitações desta análise">
          <ul className="list-disc space-y-1 pl-5 text-sm text-nett-text-muted">
            {resultado.conclusao.limitacoesDaAnalise.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Painel>
      ) : null}
    </>
  );
}

function CampoEvidencia({ bloco, edicao, editavel, onEditar }: { bloco: BlocoEvidencia; edicao?: { texto: string; nota: string }; editavel: boolean; onEditar: (v: { texto: string; nota: string }) => void }) {
  const [aberto, setAberto] = useState(false);
  const atual = bloco.valor === null ? '' : String(bloco.valor);
  const texto = edicao?.texto ?? atual;
  const alterado = montarCorrecao(bloco, texto) !== null;
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <p className="w-40 shrink-0 text-xs font-medium text-nett-text-muted">{bloco.rotulo}</p>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-nett-text">{bloco.valor === null || bloco.valor === '' ? <span className="text-nett-text-muted">Não identificado no documento.</span> : String(bloco.valor)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-nett-text-muted">
            <span className={`${CHIP} ${bloco.status === 'found' ? 'bg-nett-gold/20 text-nett-gold-light' : bloco.status === 'inferred' ? 'bg-nett-gold-dark/30 text-nett-gold-light' : 'bg-nett-raised text-nett-text-muted'}`}>{ROTULO_EVIDENCIA[bloco.status]}</span>
            {bloco.fonte ? <span>{bloco.fonte}</span> : null}
            {alterado ? <span className="font-semibold text-nett-gold-light">corrigido: “{texto || 'sem valor'}”</span> : null}
          </p>
          {bloco.trecho ? <blockquote className="mt-2 border-l-2 border-nett-gold-dark pl-3 text-xs text-nett-text-muted">“{bloco.trecho}”</blockquote> : null}
          {bloco.motivo ? <p className="mt-1 text-xs text-nett-text-muted">Por que foi inferido: {bloco.motivo}</p> : null}
          {aberto ? (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="text-xs font-medium text-nett-text">Valor correto</span>
                <input value={texto} onChange={(e) => onEditar({ texto: e.target.value, nota: edicao?.nota ?? '' })} className="mt-1 w-full rounded-xl border border-nett-text-muted/15 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-nett-text">Nota (opcional)</span>
                <input value={edicao?.nota ?? ''} maxLength={1000} onChange={(e) => onEditar({ texto, nota: e.target.value })} className="mt-1 w-full rounded-xl border border-nett-text-muted/15 px-3 py-2 text-sm" placeholder="Ex.: conferido na página 4 do PDF" />
              </label>
            </div>
          ) : null}
        </div>
        {editavel ? (
          <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-nett-gold-light hover:bg-nett-gold/10">
            {aberto ? 'Fechar' : 'Corrigir'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

/* ------------------------------- fit_assessment ------------------------------- */

function Aderencia({ r }: { r: FitAssessmentResult }) {
  const rec = r.preliminaryRecommendation;
  return (
    <>
      {r.securityAlerts.length > 0 ? (
        <Aviso tom="danger" titulo={`${r.securityAlerts.length} instrução(ões) embutida(s) em documento foram ignoradas.`}>
          O texto do edital continha ordens dirigidas à IA. Nada foi executado; confira os trechos antes de confiar no resultado.
        </Aviso>
      ) : null}

      <Painel titulo="Parecer preliminar da IA (não é decisão)">
        <p className="flex items-center gap-2 text-sm font-semibold text-nett-text">
          <IconSparkles size={16} /> {ROTULO_RECOMENDACAO[rec.decision]}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-nett-text">{rec.rationale}</p>
        <p className="mt-2 text-xs text-nett-text-muted">{rec.notice}</p>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <Item rotulo="Aderência comercial">
            <span className="font-mono font-semibold">{r.commercial.score}/100</span> · {ROTULO_NIVEL[r.commercial.band]}
          </Item>
          <Item rotulo="Habilitação">{r.qualification.score === null ? 'Sem exigência identificada' : `${r.qualification.score}/100 · ${r.qualification.band ? ROTULO_NIVEL[r.qualification.band] : ''}`}</Item>
          <Item rotulo="Confiança">
            {ROTULO_NIVEL[r.confidence.level]} ({Math.round(r.confidence.value * 100)}%)
          </Item>
        </dl>
        {r.qualification.eliminatoryImpediments.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm text-nett-gold-light">
            {r.qualification.eliminatoryImpediments.map((x, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <IconAlert size={14} /> <span>Impedimento eliminatório: {x}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Painel>

      <ListaMotivos titulo="Motivos favoráveis" itens={r.favorableReasons} />
      <ListaMotivos titulo="Motivos desfavoráveis" itens={r.unfavorableReasons} />

      {r.qualification.requirements.length > 0 ? (
        <Painel titulo={`Requisitos de habilitação (${r.qualification.requirements.length})`} semPadding>
          <ul className="divide-y divide-nett-text-muted/10">
            {r.qualification.requirements.map((q) => (
              <li key={q.id} className="px-5 py-4 text-sm">
                <p className="font-medium text-nett-text">
                  {q.description}
                  {q.eliminatory ? <span className={`${CHIP} ml-2 bg-nett-gold-light/20 text-nett-gold-light`}>eliminatório</span> : null}
                </p>
                <p className="mt-1 text-xs text-nett-text-muted">
                  {ROTULO_SITUACAO_REQUISITO[q.situation]} · {q.rationale}
                </p>
              </li>
            ))}
          </ul>
        </Painel>
      ) : null}

      {r.risks.length > 0 ? (
        <Painel titulo={`Riscos (${r.risks.length})`} semPadding>
          <ul className="divide-y divide-nett-text-muted/10">
            {r.risks.map((k) => (
              <li key={k.code} className="px-5 py-4 text-sm">
                <p className="font-medium text-nett-text">
                  {k.title} <span className={`${CHIP} ml-1 ${k.level === 'high' ? 'bg-nett-gold-light/20 text-nett-gold-light' : 'bg-nett-raised text-nett-text-muted'}`}>nível {ROTULO_NIVEL[k.level].toLowerCase()}</span>
                  {k.eliminatory ? <span className={`${CHIP} ml-1 bg-nett-gold-light/20 text-nett-gold-light`}>eliminatório</span> : null}
                </p>
                <p className="mt-1 text-nett-text-muted">{k.description}</p>
              </li>
            ))}
          </ul>
        </Painel>
      ) : null}

      {r.pendingItems.length > 0 ? (
        <Painel titulo={`Pendências (${r.pendingItems.length})`}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-nett-text-muted">
            {r.pendingItems.map((p) => (
              <li key={p.code}>{p.description}</li>
            ))}
          </ul>
        </Painel>
      ) : null}

      {r.evidence.length > 0 ? (
        <Painel titulo={`Evidências (${r.evidence.length})`} semPadding>
          <ul className="divide-y divide-nett-text-muted/10">
            {r.evidence.map((e) => (
              <li key={e.id} className="px-5 py-4 text-sm">
                <p className="flex flex-wrap items-center gap-2 text-xs text-nett-text-muted">
                  <span className={`${CHIP} ${e.status === 'proven' ? 'bg-nett-gold/20 text-nett-gold-light' : 'bg-nett-raised text-nett-text-muted'}`}>{ROTULO_EVIDENCIA_FIT[e.status]}</span>
                  {e.documentTitle ? <span>{e.documentTitle}</span> : null}
                  {e.page ? <span>p. {e.page}</span> : null}
                  {e.section ? <span>{e.section}</span> : null}
                </p>
                {e.quote ? <blockquote className="mt-2 border-l-2 border-nett-gold-dark pl-3 text-xs text-nett-text-muted">“{e.quote}”</blockquote> : null}
                <p className="mt-1 text-xs text-nett-text-muted">{e.rationale}</p>
              </li>
            ))}
          </ul>
        </Painel>
      ) : null}
    </>
  );
}

function ListaMotivos({ titulo, itens }: { titulo: string; itens: FitAssessmentResult['favorableReasons'] }) {
  if (itens.length === 0) return null;
  return (
    <Painel titulo={`${titulo} (${itens.length})`}>
      <ul className="space-y-2 text-sm">
        {itens.map((m) => (
          <li key={m.code} className="text-nett-text">
            {m.text} <span className="text-xs text-nett-text-muted">· {ROTULO_EVIDENCIA_FIT[m.status]}</span>
          </li>
        ))}
      </ul>
    </Painel>
  );
}

