'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconAlert, IconCheckCircle, IconClock, IconExternal, IconFolder, IconPlus, IconRefresh, IconTrash, IconX } from '@/components/icons';
import { dataDia } from '@/lib/plataforma/formato';
import {
  CATEGORIAS,
  JANELA_ALERTA_DIAS,
  prontidaoDocumental,
  situacaoDocumento,
  type CategoriaDocumento,
  type Documento,
  type SituacaoDocumento,
} from '@/lib/plataforma/workspace';
import { useWorkspace } from './workspace-provider';
import { botaoPrimario, botaoSecundario, Kpi, LinhasEsqueleto, PageHeader, Painel } from './ui';

const SITUACAO_ESTILO: Record<SituacaoDocumento, string> = {
  vencido: 'bg-danger-100 text-danger-700',
  'a-vencer': 'bg-warn-100 text-warn-700',
  valido: 'bg-ok-100 text-ok-700',
  permanente: 'bg-ink-100 text-ink-600',
};

function rotuloSituacao(situacao: SituacaoDocumento, dias: number | null): string {
  if (situacao === 'permanente') return 'Sem validade';
  if (dias === null) return '—';
  if (situacao === 'vencido') return dias === -1 ? 'Venceu ontem' : `Vencido há ${Math.abs(dias)} dias`;
  if (dias === 0) return 'Vence hoje';
  if (dias === 1) return 'Vence amanhã';
  return situacao === 'a-vencer' ? `Vence em ${dias} dias` : `Válido por ${dias} dias`;
}

export function DocumentosView() {
  const { ws, pronto, renovar, removerDocumento } = useWorkspace();
  const [editando, setEditando] = useState<Documento | 'novo' | null>(null);

  const documentos = useMemo(
    () =>
      ws.documentos
        .map((doc) => ({ doc, ...situacaoDocumento(doc) }))
        .sort((a, b) => (a.dias ?? 99_999) - (b.dias ?? 99_999)),
    [ws.documentos],
  );

  const contagem = {
    vencido: documentos.filter((item) => item.situacao === 'vencido').length,
    aVencer: documentos.filter((item) => item.situacao === 'a-vencer').length,
    validos: documentos.filter((item) => item.situacao === 'valido' || item.situacao === 'permanente').length,
  };
  const prontidao = prontidaoDocumental(ws.documentos);

  const categorias = Object.keys(CATEGORIAS) as CategoriaDocumento[];

  return (
    <>
      <PageHeader
        eyebrow="Habilitação"
        titulo="Cofre de documentos"
        descricao={`Certidões e documentos de habilitação com controle de validade. Tudo que vence em até ${JANELA_ALERTA_DIAS} dias entra em alerta no Painel e na Agenda — certidão vencida é uma das principais causas de inabilitação.`}
        acoes={
          <button type="button" onClick={() => setEditando('novo')} className={botaoPrimario}>
            <IconPlus size={16} /> Adicionar documento
          </button>
        }
      />

      {!pronto ? (
        <LinhasEsqueleto linhas={4} altura="h-16" />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              rotulo="Prontidão para habilitação"
              valor={`${prontidao}%`}
              detalhe="documentos aptos hoje"
              icone={<IconCheckCircle size={18} />}
              tom={prontidao === 100 ? 'ok' : prontidao >= 80 ? 'warn' : 'danger'}
            />
            <Kpi rotulo="Vencidos" valor={contagem.vencido} detalhe="precisam ser reemitidos" icone={<IconAlert size={18} />} tom="danger" />
            <Kpi rotulo="A vencer" valor={contagem.aVencer} detalhe={`nos próximos ${JANELA_ALERTA_DIAS} dias`} icone={<IconClock size={18} />} tom="warn" />
            <Kpi rotulo="Em dia" valor={contagem.validos} detalhe="válidos ou sem prazo" icone={<IconFolder size={18} />} tom="ok" />
          </div>

          <div className="space-y-5">
            {categorias.map((categoria) => {
              const itens = documentos.filter((item) => item.doc.categoria === categoria);
              if (itens.length === 0) return null;
              return (
                <Painel key={categoria} titulo={CATEGORIAS[categoria]} semPadding>
                  <ul className="divide-y divide-ink-100">
                    {itens.map(({ doc, situacao, dias }) => (
                      <li key={doc.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => setEditando(doc)}
                            className="text-left text-sm font-medium text-ink-900 hover:text-brand-700"
                          >
                            {doc.nome}
                          </button>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {doc.emissor}
                            {doc.emissao ? ` · emitido em ${dataDia(doc.emissao)}` : ''}
                            {doc.validade ? ` · válido até ${dataDia(doc.validade)}` : ''}
                          </p>
                          {doc.observacao ? <p className="mt-1 text-xs text-ink-400">{doc.observacao}</p> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${SITUACAO_ESTILO[situacao]}`}>
                            {rotuloSituacao(situacao, dias)}
                          </span>
                          {doc.linkEmissao && (situacao === 'vencido' || situacao === 'a-vencer') ? (
                            <a
                              href={doc.linkEmissao}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
                            >
                              <IconExternal size={13} /> Emitir
                            </a>
                          ) : null}
                          {doc.validadePadraoDias && situacao !== 'valido' ? (
                            <button
                              type="button"
                              onClick={() => renovar(doc.id)}
                              title={`Registra emissão hoje, válida por ${doc.validadePadraoDias} dias`}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100"
                            >
                              <IconRefresh size={13} /> Renovei
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => removerDocumento(doc.id)}
                            className="rounded-lg p-1.5 text-ink-400 hover:bg-danger-100/50 hover:text-danger-700"
                            aria-label={`Remover ${doc.nome}`}
                          >
                            <IconTrash size={15} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Painel>
              );
            })}
          </div>
        </>
      )}

      {editando ? <FormularioDocumento documento={editando === 'novo' ? null : editando} onFechar={() => setEditando(null)} /> : null}
    </>
  );
}

function FormularioDocumento({ documento, onFechar }: { documento: Documento | null; onFechar: () => void }) {
  const { salvarDocumento } = useWorkspace();
  const [form, setForm] = useState({
    nome: documento?.nome ?? '',
    categoria: documento?.categoria ?? ('fiscal' as CategoriaDocumento),
    emissor: documento?.emissor ?? '',
    emissao: documento?.emissao ?? '',
    validade: documento?.validade ?? '',
    validadePadraoDias: documento?.validadePadraoDias?.toString() ?? '',
    linkEmissao: documento?.linkEmissao ?? '',
    observacao: documento?.observacao ?? '',
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onFechar();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onFechar]);

  const campo = 'mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="form-doc-titulo">
      <button type="button" className="absolute inset-0 bg-ink-950/40" aria-label="Fechar" onClick={onFechar} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.nome.trim()) return;
          const dias = Number(form.validadePadraoDias);
          salvarDocumento({
            id: documento?.id,
            nome: form.nome.trim(),
            categoria: form.categoria,
            emissor: form.emissor.trim(),
            emissao: form.emissao || null,
            validade: form.validade || null,
            validadePadraoDias: Number.isFinite(dias) && dias > 0 ? dias : null,
            linkEmissao: /^https?:\/\//.test(form.linkEmissao) ? form.linkEmissao : null,
            observacao: form.observacao.trim(),
          });
          onFechar();
        }}
        className="relative max-h-[92dvh] w-full max-w-lg animate-[fade-up_0.25s_ease-out_both] overflow-y-auto rounded-t-3xl bg-white p-6 shadow-lift sm:rounded-3xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="form-doc-titulo" className="text-lg font-semibold text-ink-900">
            {documento ? 'Editar documento' : 'Novo documento'}
          </h2>
          <button type="button" onClick={onFechar} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100" aria-label="Fechar">
            <IconX size={20} />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-ink-600">Nome do documento *</span>
            <input required value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} className={campo} placeholder="Ex.: Certidão Negativa de Débitos Trabalhistas" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-600">Categoria</span>
            <select value={form.categoria} onChange={(event) => setForm({ ...form, categoria: event.target.value as CategoriaDocumento })} className={`${campo} bg-white`}>
              {(Object.entries(CATEGORIAS) as Array<[CategoriaDocumento, string]>).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-600">Órgão emissor</span>
            <input value={form.emissor} onChange={(event) => setForm({ ...form, emissor: event.target.value })} className={campo} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-600">Emitido em</span>
            <input type="date" value={form.emissao} onChange={(event) => setForm({ ...form, emissao: event.target.value })} className={campo} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-600">Válido até (vazio = sem validade)</span>
            <input type="date" value={form.validade} onChange={(event) => setForm({ ...form, validade: event.target.value })} className={campo} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-600">Validade usual (dias)</span>
            <input inputMode="numeric" value={form.validadePadraoDias} onChange={(event) => setForm({ ...form, validadePadraoDias: event.target.value.replace(/\D/g, '') })} className={campo} placeholder="Ex.: 180" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-600">Link para emissão</span>
            <input type="url" value={form.linkEmissao} onChange={(event) => setForm({ ...form, linkEmissao: event.target.value })} className={campo} placeholder="https://" />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-ink-600">Observação</span>
            <textarea value={form.observacao} onChange={(event) => setForm({ ...form, observacao: event.target.value })} rows={2} className={campo} />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onFechar} className={botaoSecundario}>
            Cancelar
          </button>
          <button type="submit" className={botaoPrimario}>
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
}
