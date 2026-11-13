/** Eventos de agenda derivados do workspace: prazos do pipeline e vencimentos de documentos. */
import { chaveDia } from './formato';
import { ETAPAS_ATIVAS, situacaoDocumento, type Workspace } from './workspace';

export type TipoEvento = 'encerramento' | 'abertura' | 'documento';

export type EventoAgenda = {
  id: string;
  tipo: TipoEvento;
  /** YYYY-MM-DD no fuso de Brasília. */
  dia: string;
  /** Instante exato, quando conhecido (prazos de propostas). */
  quando: string | null;
  titulo: string;
  detalhe: string;
  href: string;
};

export const TIPO_EVENTO: Record<TipoEvento, { rotulo: string; ponto: string; chip: string }> = {
  encerramento: { rotulo: 'Fim das propostas', ponto: 'bg-danger-500', chip: 'bg-danger-100 text-danger-700' },
  abertura: { rotulo: 'Início das propostas', ponto: 'bg-brand-500', chip: 'bg-brand-50 text-brand-700' },
  documento: { rotulo: 'Vencimento de documento', ponto: 'bg-warn-500', chip: 'bg-warn-100 text-warn-700' },
};

/** Eventos ainda por acontecer: prazos com hora contam até o instante; os de dia inteiro, até o fim do dia. */
export function eventosFuturos(eventos: EventoAgenda[], agora = Date.now()): EventoAgenda[] {
  const hoje = chaveDia(new Date(agora));
  return eventos.filter((evento) => (evento.quando ? new Date(evento.quando).getTime() > agora : evento.dia >= hoje));
}

export function eventosAgenda(ws: Workspace): EventoAgenda[] {
  const eventos: EventoAgenda[] = [];

  for (const card of ws.pipeline) {
    if (!ETAPAS_ATIVAS.includes(card.etapa)) continue;
    const op = card.oportunidade;
    const href = `/radar/${op.cnpj}/${op.ano}/${op.sequencial}`;
    if (op.encerramentoPropostas) {
      eventos.push({
        id: `${card.id}-fim`,
        tipo: 'encerramento',
        dia: chaveDia(op.encerramentoPropostas),
        quando: op.encerramentoPropostas,
        titulo: op.objeto,
        detalhe: `${op.orgao} · ${op.uf}`,
        href,
      });
    }
    if (op.aberturaPropostas && op.aberturaPropostas !== op.encerramentoPropostas) {
      eventos.push({
        id: `${card.id}-inicio`,
        tipo: 'abertura',
        dia: chaveDia(op.aberturaPropostas),
        quando: op.aberturaPropostas,
        titulo: op.objeto,
        detalhe: `${op.orgao} · ${op.uf}`,
        href,
      });
    }
  }

  for (const doc of ws.documentos) {
    if (!doc.validade) continue;
    const { situacao } = situacaoDocumento(doc);
    eventos.push({
      id: `doc-${doc.id}`,
      tipo: 'documento',
      dia: doc.validade,
      quando: null,
      titulo: doc.nome,
      detalhe: situacao === 'vencido' ? 'Vencido — reemitir antes da próxima habilitação' : doc.emissor,
      href: '/documentos',
    });
  }

  return eventos.sort((a, b) => a.dia.localeCompare(b.dia) || (a.quando ?? '').localeCompare(b.quando ?? ''));
}
