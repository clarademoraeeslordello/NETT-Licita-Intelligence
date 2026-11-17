/**
 * Carrega, para a tela de revisão (T-405), uma análise visível à empresa ativa. Leitura direta no servidor
 * porque a rota `GET …/analyses/{id}` é da T-303 (agente 03, ainda bloqueada). Troque por ela quando existir.
 * Escopo: só análise pública (`companyId` nulo) ou da própria empresa; qualquer outra coisa é "não encontrada".
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { parseAnalysisResult } from '@/contracts';
import type { Db } from '@/server/db';
import { aiAnalyses, humanReviews, opportunities, userAccounts } from '@/server/db/schema';
import { effectiveReviewStatus, listReviews } from '@/server/analysis/reviews/service';
import type { StatusRevisao } from '@/components/plataforma/revisao-logica';

export type DadosRevisao = {
  empresaId: string;
  analise: {
    id: string;
    kind: 'tender_summary' | 'fit_assessment' | 'risk_review';
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    engine: 'llm' | 'local_rules' | null;
    model: string | null;
    confidence: 'high' | 'medium' | 'low' | null;
    warnings: string[];
    finishedAt: string | null;
    publica: boolean;
    /** Situação para ESTA empresa (análise pública é compartilhada; o parecer é por empresa). */
    statusRevisao: StatusRevisao;
  };
  oportunidade: { id: string; title: string; agencyName: string; uf: string | null; url: string };
  /** `null` quando a análise não concluiu ou o resultado não passa no schema do tipo. */
  resultado: unknown;
  erroResultado: string | null;
  pareceres: Array<{ id: string; decision: 'approved' | 'approved_with_changes' | 'rejected'; comment: string | null; correcoes: number; criadoEm: string; revisor: string }>;
  decisaoParticipacao: { id: string; decision: 'approved' | 'approved_with_changes' | 'rejected'; createdAt: string } | null;
};

export async function carregarRevisao(db: Db, empresaId: string, analiseId: string): Promise<DadosRevisao | null> {
  const [a] = await db.select().from(aiAnalyses).where(eq(aiAnalyses.id, analiseId));
  if (!a || (a.companyId !== null && a.companyId !== empresaId)) return null;

  const [o] = await db.select().from(opportunities).where(eq(opportunities.id, a.opportunityId));
  if (!o) return null;

  let resultado: unknown = null;
  let erroResultado: string | null = null;
  if (a.status === 'succeeded') {
    const r = parseAnalysisResult(a.kind, a.result);
    if (r.success) resultado = r.data;
    else erroResultado = 'O resultado desta análise não está no formato esperado e não pode ser revisado. Peça uma nova análise.';
  }

  const statusRevisao = a.status === 'succeeded' ? await effectiveReviewStatus(db, empresaId, a.id) : a.reviewStatus;
  const { items } = await listReviews(db, empresaId, { subjectType: 'ai_analysis', subjectId: a.id, limit: 20 });
  const nomes = new Map<string, string>();
  if (items.length > 0) {
    const us = await db
      .select({ id: userAccounts.id, name: userAccounts.name })
      .from(userAccounts)
      .where(inArray(userAccounts.id, [...new Set(items.map((i) => i.reviewerUserId))]));
    for (const u of us) nomes.set(u.id, u.name);
  }

  const [decisao] = await db
    .select({ id: humanReviews.id, decision: humanReviews.decision, createdAt: humanReviews.createdAt })
    .from(humanReviews)
    .where(and(eq(humanReviews.companyId, empresaId), eq(humanReviews.subjectType, 'bid_decision'), eq(humanReviews.subjectId, o.id)))
    .orderBy(desc(humanReviews.createdAt), desc(humanReviews.id))
    .limit(1);

  return {
    empresaId,
    analise: {
      id: a.id,
      kind: a.kind,
      status: a.status,
      engine: a.engine,
      model: a.model,
      confidence: a.confidence,
      warnings: a.warnings,
      finishedAt: a.finishedAt ? a.finishedAt.toISOString() : null,
      publica: a.companyId === null,
      statusRevisao,
    },
    oportunidade: { id: o.id, title: o.title, agencyName: o.agencyName, uf: o.uf, url: o.url },
    resultado,
    erroResultado,
    pareceres: items.map((i) => ({ id: i.id, decision: i.decision, comment: i.comment, correcoes: i.corrections.length, criadoEm: i.createdAt, revisor: nomes.get(i.reviewerUserId) ?? 'Usuário' })),
    decisaoParticipacao: decisao ? { id: decisao.id, decision: decisao.decision, createdAt: decisao.createdAt.toISOString() } : null,
  };
}
