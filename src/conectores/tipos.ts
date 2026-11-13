/**
 * Arquitetura de conectores. Cada fonte de licitações implementa `ConectorLicitacoes`
 * de forma independente; o orquestrador de coleta não conhece detalhes da fonte.
 */
import type { DocumentoColetado, ItemColetado, OportunidadeColetada } from '../contrato/normalizada.js';
import type { FonteId } from '../contrato/oportunidade.js';

/** Unidade de paginação retomável (ex.: modalidade 6 no dia 2026-11-10). */
export type Particao = { chave: string; params: Record<string, string | number>; diaFechado: boolean };

export type Pagina = {
  registros: OportunidadeColetada[];
  pagina: number;
  totalPaginas: number;
  totalRegistros: number;
  /** Registros brutos que não puderam ser normalizados (contabilizados como erro). */
  invalidos: number;
};

export interface ConectorLicitacoes {
  readonly fonte: FonteId;
  /** `null` quando a fonte está operacional; senão, o motivo (credencial, acesso não definido...). */
  indisponibilidade(): string | null;
  particoes(referencia: Date, janelaDias: number): Particao[];
  listarPagina(particao: Particao, pagina: number): Promise<Pagina>;
}

/** Enriquecimento (documentos/itens). Hoje fornecido pelo PNCP para qualquer compra com número de controle. */
export interface EnriquecedorOportunidade {
  documentos(numeroControlePncp: string): Promise<DocumentoColetado[]>;
  itens(numeroControlePncp: string): Promise<ItemColetado[]>;
}

export class FonteIndisponivel extends Error {
  constructor(
    readonly fonte: FonteId,
    motivo: string,
  ) {
    super(`${fonte}: ${motivo}`);
    this.name = 'FonteIndisponivel';
  }
}

/** Datas em YYYY-MM-DD no fuso de Brasília, da mais recente para a mais antiga. */
export function diasDaJanela(referencia: Date, janelaDias: number): Array<{ dia: string; fechado: boolean }> {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dias: Array<{ dia: string; fechado: boolean }> = [];
  for (let i = 0; i <= janelaDias; i += 1) {
    dias.push({ dia: fmt.format(new Date(referencia.getTime() - i * 86_400_000)), fechado: i > 0 });
  }
  return dias;
}
