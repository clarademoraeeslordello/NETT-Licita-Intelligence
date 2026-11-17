'use client';

import { useState } from 'react';
import { IconAlert, IconCheckCircle } from '@/components/icons';
import { chamarApi, mensagemDeErro } from './api-v1';
import type { DecisaoParticipacao } from './pipeline-logica';
import { botaoPrimario } from './ui';

export type ParecerRegistrado = { id: string; decision: DecisaoParticipacao; createdAt: string };

const ROTULO: Record<DecisaoParticipacao, string> = {
  approved: 'Participar',
  approved_with_changes: 'Participar (com ajustes)',
  rejected: 'Não participar',
};

/**
 * Decisão de participar — sempre humana e registrada (`HumanReview`, subjectType `bid_decision`,
 * subjectId = id da oportunidade). A IA só sinaliza. O parecer mais recente vale (CONTRACTS §2.8).
 */
export function DecisaoParticipacaoForm({
  companyId,
  opportunityId,
  atual,
  podeEscrever,
  onRegistrado,
}: {
  companyId: string;
  opportunityId: string;
  atual: ParecerRegistrado | null;
  podeEscrever: boolean;
  onRegistrado: (p: ParecerRegistrado) => void;
}) {
  const [decisao, setDecisao] = useState<'approved' | 'rejected'>('approved');
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const precisaComentario = decisao === 'rejected';

  const registrar = async () => {
    if (precisaComentario && !comentario.trim()) {
      setErro('Explique o motivo de não participar.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const r = await chamarApi<{ review: { id: string; decision: DecisaoParticipacao; createdAt: string } }>(`/companies/${companyId}/reviews`, {
        method: 'POST',
        corpo: { subjectType: 'bid_decision', subjectId: opportunityId, decision: decisao, comment: comentario.trim() || undefined },
      });
      onRegistrado({ id: r.review.id, decision: r.review.decision, createdAt: r.review.createdAt });
      setComentario('');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <fieldset className="rounded-xl border border-nett-text-muted/15 p-4" disabled={!podeEscrever || enviando}>
      <legend className="px-1 text-xs font-medium text-nett-text">Decisão de participar</legend>
      <p className="text-xs text-nett-text-muted">A decisão é da equipe, nunca da IA, e fica registrada com data e responsável.</p>

      {atual ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-nett-text" role="status">
          {atual.decision === 'rejected' ? <IconAlert size={15} /> : <IconCheckCircle size={15} />}
          Parecer atual: <strong>{ROTULO[atual.decision]}</strong>
        </p>
      ) : (
        <p className="mt-2 text-sm text-nett-text-muted">Nenhum parecer registrado.</p>
      )}

      {podeEscrever ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(['approved', 'rejected'] as const).map((valor) => (
              <button
                key={valor}
                type="button"
                aria-pressed={decisao === valor}
                onClick={() => setDecisao(valor)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                  decisao === valor ? 'border-nett-gold bg-nett-gold/20 text-nett-gold-light' : 'border-nett-text-muted/15 text-nett-text hover:bg-nett-black'
                }`}
              >
                {ROTULO[valor]}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="text-xs font-medium text-nett-text">Comentário{precisaComentario ? ' (obrigatório)' : ''}</span>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={2}
              maxLength={5000}
              className="mt-1 w-full resize-y rounded-xl border border-nett-text-muted/15 px-3 py-2 text-sm"
            />
          </label>
          {erro ? (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-nett-gold-light">
              <IconAlert size={15} /> {erro}
            </p>
          ) : null}
          <button type="button" onClick={registrar} disabled={enviando} className={botaoPrimario}>
            {enviando ? 'Registrando…' : 'Registrar parecer'}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-nett-text-muted">Seu papel é de leitura: só consultores registram pareceres.</p>
      )}
    </fieldset>
  );
}
