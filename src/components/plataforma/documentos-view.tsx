'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconAlert, IconCheckCircle, IconClock, IconExternal, IconFolder, IconPlus, IconRefresh, IconX } from '@/components/icons';
import { useSessao } from '@/components/sessao/sessao-provider';
import { dataDia } from '@/lib/plataforma/formato';
import { CATEGORIAS, JANELA_ALERTA_DIAS, type CategoriaDocumento } from '@/lib/plataforma/workspace';
import { chamarApi, mensagemDeErro, useCarga } from './api-v1';
import { prontidao, renovacao, situacaoCertidao, type CertidaoApi, type SituacaoCertidao } from './pipeline-logica';
import { botaoPrimario, botaoSecundario, ErroCarregamento, Kpi, LinhasEsqueleto, PageHeader, Painel, Vazio } from './ui';

const SITUACAO_ESTILO: Record<SituacaoCertidao, string> = {
  vencido: 'bg-nett-text/10 text-nett-text',
  'a-vencer': 'bg-nett-gold-dark/30 text-nett-gold-light',
  valido: 'bg-nett-gold/20 text-nett-gold-light',
  permanente: 'bg-nett-raised text-nett-text',
};

function rotuloSituacao(situacao: SituacaoCertidao, dias: number | null): string {
  if (situacao === 'permanente') return 'Sem validade';
  if (dias === null) return '—';
  if (situacao === 'vencido') return dias === -1 ? 'Venceu ontem' : `Vencido há ${Math.abs(dias)} dias`;
  if (dias === 0) return 'Vence hoje';
  if (dias === 1) return 'Vence amanhã';
  return situacao === 'a-vencer' ? `Vence em ${dias} dias` : `Válido por ${dias} dias`;
}

type Resposta = { items: CertidaoApi[] };

export function DocumentosView() {
  const { empresaAtual } = useSessao();
  if (!empresaAtual) {
    return (
      <>
        <PageHeader eyebrow="Habilitação" titulo="Cofre de certidões" />
        <Vazio icone={<IconFolder size={24} />} titulo="Nenhuma empresa selecionada">
          Peça a um administrador para vincular você a uma empresa cliente.
        </Vazio>
      </>
    );
  }
  return <Cofre key={empresaAtual.id} empresaId={empresaAtual.id} podeEscrever={empresaAtual.role !== 'viewer'} />;
}

function Cofre({ empresaId, podeEscrever }: { empresaId: string; podeEscrever: boolean }) {
  const { dados, setDados, erro, carregando, recarregar } = useCarga(() => chamarApi<Resposta>(`/companies/${empresaId}/certificates`), empresaId);
  const [editando, setEditando] = useState<CertidaoApi | 'nova' | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const itens = useMemo(
    () =>
      (dados?.items ?? [])
        .map((c) => ({ c, ...situacaoCertidao(c.validUntil) }))
        .sort((a, b) => (a.dias ?? 99_999) - (b.dias ?? 99_999)),
    [dados],
  );
  const contagem = {
    vencido: itens.filter((i) => i.situacao === 'vencido').length,
    aVencer: itens.filter((i) => i.situacao === 'a-vencer').length,
    validos: itens.filter((i) => i.situacao === 'valido' || i.situacao === 'permanente').length,
  };
  const pronta = prontidao(dados?.items ?? []);
  const categorias = Object.keys(CATEGORIAS) as CategoriaDocumento[];

  const aplicar = (nova: CertidaoApi) =>
    setDados((d) => (d ? { items: d.items.some((c) => c.id === nova.id) ? d.items.map((c) => (c.id === nova.id ? nova : c)) : [nova, ...d.items] } : { items: [nova] }));

  const renovar = async (c: CertidaoApi) => {
    const nova = renovacao(c);
    if (!nova) return;
    setFalha(null);
    try {
      const r = await chamarApi<{ certificate: CertidaoApi }>(`/companies/${empresaId}/certificates/${c.id}`, { method: 'PATCH', corpo: nova });
      aplicar(r.certificate);
    } catch (e) {
      setFalha(mensagemDeErro(e));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Habilitação"
        titulo="Cofre de certidões"
        descricao={`Controle de validade das certidões da empresa. O que vence em até ${JANELA_ALERTA_DIAS} dias entra em alerta — certidão vencida é uma das principais causas de inabilitação. Por ora o cofre guarda só os dados da certidão; o envio do arquivo chega em uma próxima etapa.`}
        acoes={
          podeEscrever ? (
            <button type="button" onClick={() => setEditando('nova')} className={botaoPrimario}>
              <IconPlus size={16} /> Adicionar certidão
            </button>
          ) : undefined
        }
      />

      {falha ? (
        <p role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-nett-gold/30 bg-nett-gold-dark/15 px-4 py-2.5 text-sm text-nett-gold-light">
          <IconAlert size={16} /> {falha}
        </p>
      ) : null}

      {erro ? (
        <ErroCarregamento mensagem="Não foi possível carregar o cofre." dica={erro} onTentar={recarregar} />
      ) : carregando && !dados ? (
        <LinhasEsqueleto linhas={4} altura="h-16" />
      ) : itens.length === 0 ? (
        <Vazio
          icone={<IconFolder size={24} />}
          titulo="Nenhuma certidão cadastrada"
          acao={
            podeEscrever ? (
              <button type="button" onClick={() => setEditando('nova')} className={botaoPrimario}>
                <IconPlus size={16} /> Adicionar certidão
              </button>
            ) : undefined
          }
        >
          Cadastre as certidões de habilitação para acompanhar vencimentos.
        </Vazio>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi rotulo="Prontidão para habilitação" valor={`${pronta}%`} detalhe="certidões aptas hoje" icone={<IconCheckCircle size={18} />} tom={pronta === 100 ? 'ok' : pronta >= 80 ? 'warn' : 'danger'} />
            <Kpi rotulo="Vencidas" valor={contagem.vencido} detalhe="precisam ser reemitidas" icone={<IconAlert size={18} />} tom="danger" />
            <Kpi rotulo="A vencer" valor={contagem.aVencer} detalhe={`nos próximos ${JANELA_ALERTA_DIAS} dias`} icone={<IconClock size={18} />} tom="warn" />
            <Kpi rotulo="Em dia" valor={contagem.validos} detalhe="válidas ou sem prazo" icone={<IconFolder size={18} />} tom="ok" />
          </div>

          <div className="space-y-5">
            {categorias.map((categoria) => {
              const lista = itens.filter((i) => i.c.category === categoria);
              if (lista.length === 0) return null;
              return (
                <Painel key={categoria} titulo={CATEGORIAS[categoria]} semPadding>
                  <ul className="divide-y divide-nett-text-muted/10">
                    {lista.map(({ c, situacao, dias }) => (
                      <li key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          {podeEscrever ? (
                            <button type="button" onClick={() => setEditando(c)} className="text-left text-sm font-medium text-nett-text hover:text-nett-gold-light">
                              {c.title}
                            </button>
                          ) : (
                            <p className="text-sm font-medium text-nett-text">{c.title}</p>
                          )}
                          <p className="mt-0.5 text-xs text-nett-text-muted">
                            {c.issuer}
                            {c.issuedAt ? ` · emitida em ${dataDia(c.issuedAt)}` : ''}
                            {c.validUntil ? ` · válida até ${dataDia(c.validUntil)}` : ''}
                            {c.hasFile ? '' : ' · arquivo ainda não anexado'}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${SITUACAO_ESTILO[situacao]}`}>{rotuloSituacao(situacao, dias)}</span>
                          {c.issueUrl && (situacao === 'vencido' || situacao === 'a-vencer') ? (
                            <a href={c.issueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-nett-gold-light hover:bg-nett-gold/10">
                              <IconExternal size={13} /> Emitir
                            </a>
                          ) : null}
                          {podeEscrever && c.defaultValidityDays && situacao !== 'valido' ? (
                            <button
                              type="button"
                              onClick={() => void renovar(c)}
                              title={`Registra emissão hoje, válida por ${c.defaultValidityDays} dias`}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-nett-text hover:bg-nett-raised"
                            >
                              <IconRefresh size={13} /> Renovei
                            </button>
                          ) : null}
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

      {editando ? (
        <Formulario
          empresaId={empresaId}
          certidao={editando === 'nova' ? null : editando}
          onFechar={() => setEditando(null)}
          onSalva={(c) => {
            aplicar(c);
            setEditando(null);
          }}
        />
      ) : null}
    </>
  );
}

function Formulario({ empresaId, certidao, onFechar, onSalva }: { empresaId: string; certidao: CertidaoApi | null; onFechar: () => void; onSalva: (c: CertidaoApi) => void }) {
  const [form, setForm] = useState({
    title: certidao?.title ?? '',
    category: certidao?.category ?? ('fiscal' as CategoriaDocumento),
    issuer: certidao?.issuer ?? '',
    issuedAt: certidao?.issuedAt ?? '',
    validUntil: certidao?.validUntil ?? '',
    defaultValidityDays: certidao?.defaultValidityDays?.toString() ?? '',
    issueUrl: certidao?.issueUrl ?? '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onFechar();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onFechar]);

  const campo = 'mt-1 w-full rounded-xl border border-nett-text-muted/15 px-3 py-2.5 text-sm';

  const enviar = async () => {
    const dias = Number(form.defaultValidityDays);
    const corpo = {
      title: form.title.trim(),
      category: form.category,
      issuer: form.issuer.trim(),
      issuedAt: form.issuedAt || null,
      validUntil: form.validUntil || null,
      defaultValidityDays: Number.isInteger(dias) && dias > 0 ? dias : null,
      issueUrl: form.issueUrl.trim() || null,
    };
    if (corpo.issueUrl && !/^https:\/\//.test(corpo.issueUrl)) return setErro('O link de emissão deve começar com https://');
    if (corpo.issuedAt && corpo.validUntil && corpo.issuedAt > corpo.validUntil) return setErro('A validade não pode ser anterior à emissão.');
    setEnviando(true);
    setErro(null);
    try {
      const r = certidao
        ? await chamarApi<{ certificate: CertidaoApi }>(`/companies/${empresaId}/certificates/${certidao.id}`, { method: 'PATCH', corpo })
        : await chamarApi<{ certificate: CertidaoApi }>(`/companies/${empresaId}/certificates`, { method: 'POST', corpo });
      onSalva(r.certificate);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="form-doc-titulo">
      <button type="button" className="absolute inset-0 bg-nett-black/40" aria-label="Fechar" onClick={onFechar} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void enviar();
        }}
        className="relative max-h-[92dvh] w-full max-w-lg animate-[fade-up_0.25s_ease-out_both] overflow-y-auto rounded-t-3xl bg-nett-surface p-6 shadow-lift sm:rounded-3xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="form-doc-titulo" className="text-lg font-semibold text-nett-text">
            {certidao ? 'Editar certidão' : 'Nova certidão'}
          </h2>
          <button type="button" onClick={onFechar} className="rounded-lg p-1.5 text-nett-text-muted hover:bg-nett-raised" aria-label="Fechar">
            <IconX size={20} />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-nett-text">Nome da certidão *</span>
            <input required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={campo} placeholder="Ex.: Certidão Negativa de Débitos Trabalhistas" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-nett-text">Categoria</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CategoriaDocumento })} className={`${campo} bg-nett-surface`}>
              {(Object.entries(CATEGORIAS) as Array<[CategoriaDocumento, string]>).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-nett-text">Órgão emissor *</span>
            <input required maxLength={200} value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} className={campo} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-nett-text">Emitida em</span>
            <input type="date" value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })} className={campo} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-nett-text">Válida até (vazio = sem validade)</span>
            <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className={campo} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-nett-text">Validade usual (dias)</span>
            <input inputMode="numeric" value={form.defaultValidityDays} onChange={(e) => setForm({ ...form, defaultValidityDays: e.target.value.replace(/\D/g, '') })} className={campo} placeholder="Ex.: 180" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-nett-text">Link para emissão (https)</span>
            <input type="url" value={form.issueUrl} onChange={(e) => setForm({ ...form, issueUrl: e.target.value })} className={campo} placeholder="https://" />
          </label>
        </div>

        {erro ? (
          <p role="alert" className="mt-4 flex items-center gap-1.5 text-sm text-nett-gold-light">
            <IconAlert size={15} /> {erro}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onFechar} className={botaoSecundario}>
            Cancelar
          </button>
          <button type="submit" disabled={enviando} className={botaoPrimario}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  );
}
