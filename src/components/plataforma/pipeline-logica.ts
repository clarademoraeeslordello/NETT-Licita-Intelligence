/**
 * Lógica pura do pipeline persistido e do cofre (T-406). Sem React nem rede, para testar com `npm run test:ui`.
 * Etapas e enums seguem o contrato (`pipelineStage`, em inglês); os rótulos são da UI (pt-BR).
 */
import { JANELA_ALERTA_DIAS } from '@/lib/plataforma/workspace';

export type EtapaApi = 'triage' | 'analysis' | 'documentation' | 'proposal' | 'dispute' | 'result';
export type DecisaoParticipacao = 'approved' | 'approved_with_changes' | 'rejected';

export const ETAPAS: Array<{ id: EtapaApi; label: string; descricao: string; cor: string; exigeParecer: boolean }> = [
  { id: 'triage', label: 'Triagem', descricao: 'Vale a pena disputar?', cor: 'bg-nett-text-muted/45', exigeParecer: false },
  { id: 'analysis', label: 'Análise do edital', descricao: 'Leitura, riscos e exigências', cor: 'bg-nett-gold-light', exigeParecer: false },
  { id: 'documentation', label: 'Documentação', descricao: 'Habilitação e declarações', cor: 'bg-nett-gold', exigeParecer: false },
  { id: 'proposal', label: 'Proposta', descricao: 'Preço e proposta comercial', cor: 'bg-nett-gold', exigeParecer: true },
  { id: 'dispute', label: 'Em disputa', descricao: 'Sessão pública e lances', cor: 'bg-nett-gold', exigeParecer: true },
  { id: 'result', label: 'Resultado', descricao: 'Ganhas e perdidas', cor: 'bg-nett-gold', exigeParecer: true },
];
export const ETAPAS_ATIVAS: EtapaApi[] = ['triage', 'analysis', 'documentation', 'proposal', 'dispute'];
export const exigeParecer = (etapa: EtapaApi) => ETAPAS.find((e) => e.id === etapa)?.exigeParecer ?? false;
export const rotuloEtapa = (etapa: EtapaApi) => ETAPAS.find((e) => e.id === etapa)?.label ?? etapa;

export type CardApi = {
  tracking: { id: string; stage: EtapaApi; proposalValue: string | null; outcome: 'won' | 'lost' | 'withdrawn' | null; bidDecisionReviewId: string | null; notes: string; updatedAt: string };
  opportunity: { id: string; title: string; agencyName: string; uf: string | null; modalityName: string | null; proposalsCloseAt: string | null; estimatedValue: string | null; url: string };
  latestBidDecision: { id: string; decision: DecisaoParticipacao; createdAt: string } | null;
  latestAnalysis: { id: string; kind: string } | null;
};

export type Movimento = { ok: true; bidDecisionReviewId: string | null } | { ok: false; motivo: string };

/**
 * A UI antecipa a regra do servidor (que é a autoridade: `assertBidDecisionAuthorizes`): para entrar em
 * proposta, disputa ou resultado vale o parecer MAIS RECENTE da empresa, e ele precisa aprovar a participação.
 */
export function podeMover(card: CardApi, destino: EtapaApi): Movimento {
  if (destino === card.tracking.stage) return { ok: true, bidDecisionReviewId: card.tracking.bidDecisionReviewId };
  if (!exigeParecer(destino)) return { ok: true, bidDecisionReviewId: card.tracking.bidDecisionReviewId };
  const parecer = card.latestBidDecision;
  if (!parecer) return { ok: false, motivo: 'Registre o parecer de decisão (participar ou não) antes de avançar para esta etapa.' };
  if (parecer.decision === 'rejected') return { ok: false, motivo: 'O parecer mais recente rejeita a participação. Registre um novo parecer para avançar.' };
  return { ok: true, bidDecisionReviewId: parecer.id };
}

/* --------------------------------- dinheiro --------------------------------- */

/** "185.000,50" | "185000" | "1500.25" → "185000.50" (string decimal do contrato) ou null se inválido. */
export function paraDecimal(entrada: string): string | null {
  let t = entrada.trim().replace(/^R\$\s*/, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const m = /^(\d{1,14})(?:\.(\d{1,4}))?$/.exec(t);
  if (!m) return null;
  const valor = `${m[1]}${m[2] ? `.${m[2]}` : ''}`;
  return Number(valor) > 0 ? valor : null;
}

/** Soma em centavos inteiros (sem float acumulado). Entradas decimais com até 4 casas. */
export function somarCentavos(valores: Array<string | null | undefined>): bigint {
  let total = 0n;
  for (const v of valores) {
    if (!v) continue;
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v);
    if (!m) continue;
    const centavos = BigInt(m[2]! + (m[3] ?? '').padEnd(2, '0').slice(0, 2));
    total += m[1] ? -centavos : centavos;
  }
  return total;
}
export const centavosParaReais = (c: bigint) => Number(c) / 100;

/** Valor em disputa: proposta da empresa, ou o estimado quando ainda não há proposta. */
export function valorEmDisputa(cards: CardApi[]): number {
  const ativos = cards.filter((c) => ETAPAS_ATIVAS.includes(c.tracking.stage));
  return centavosParaReais(somarCentavos(ativos.map((c) => c.tracking.proposalValue ?? c.opportunity.estimatedValue)));
}
export function valorConquistado(cards: CardApi[]): number {
  const ganhas = cards.filter((c) => c.tracking.outcome === 'won');
  return centavosParaReais(somarCentavos(ganhas.map((c) => c.tracking.proposalValue ?? c.opportunity.estimatedValue)));
}

/* ----------------------------------- cofre ---------------------------------- */

export type CertidaoApi = {
  id: string;
  title: string;
  category: 'fiscal' | 'trabalhista' | 'juridica' | 'economica' | 'tecnica';
  issuer: string;
  issuedAt: string | null;
  validUntil: string | null;
  defaultValidityDays: number | null;
  issueUrl: string | null;
  hasFile: boolean;
};

export type SituacaoCertidao = 'valido' | 'a-vencer' | 'vencido' | 'permanente';
const DIA_MS = 86_400_000;

/** Válida até o fim do dia de `validUntil`, no horário de Brasília (America/Sao_Paulo, UTC−3 sem horário de verão). */
export function situacaoCertidao(validUntil: string | null, agora = Date.now()): { situacao: SituacaoCertidao; dias: number | null } {
  if (!validUntil) return { situacao: 'permanente', dias: null };
  const fim = new Date(`${validUntil}T23:59:59-03:00`).getTime();
  const dias = Math.floor((fim - agora) / DIA_MS);
  if (fim < agora) return { situacao: 'vencido', dias };
  return { situacao: dias <= JANELA_ALERTA_DIAS ? 'a-vencer' : 'valido', dias };
}

/** Percentual do cofre sem vencidas. Vazio = 0 (não há o que apresentar). */
export function prontidao(certidoes: CertidaoApi[], agora = Date.now()): number {
  if (certidoes.length === 0) return 0;
  const aptas = certidoes.filter((c) => situacaoCertidao(c.validUntil, agora).situacao !== 'vencido').length;
  return Math.round((aptas / certidoes.length) * 100);
}

/** Data (YYYY-MM-DD) em Brasília, `deslocamentoDias` a partir de `agora`. */
export function diaEmBrasilia(deslocamentoDias = 0, agora = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(agora + deslocamentoDias * DIA_MS));
}

/** "Renovei": emissão hoje e, havendo validade usual, nova validade. Sem validade usual não há o que calcular. */
export function renovacao(c: Pick<CertidaoApi, 'defaultValidityDays'>, agora = Date.now()): { issuedAt: string; validUntil: string } | null {
  if (!c.defaultValidityDays) return null;
  return { issuedAt: diaEmBrasilia(0, agora), validUntil: diaEmBrasilia(c.defaultValidityDays, agora) };
}
