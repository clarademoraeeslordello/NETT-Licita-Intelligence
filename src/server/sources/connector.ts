/**
 * Interface dos conectores de fonte (CONTRACTS.md §5) e tipos de saída da normalização.
 *
 * `OpportunityUpsert`, `OpportunityItemUpsert` e `DocumentRef` vivem em `src/contracts` desde a 1.2.0.
 */
import {
  documentRef,
  opportunityItemUpsert,
  opportunityUpsert,
  type DocumentRef,
  type OpportunityItemUpsert,
  type OpportunityUpsert,
} from '@/contracts';

// Canônicos desde os contratos 1.2.0 (src/contracts); reexportados para não quebrar importações.
export { documentRef, opportunityItemUpsert, opportunityUpsert };
export type { DocumentRef, OpportunityItemUpsert, OpportunityUpsert };

export type FetchedRecord = { externalId: string; payload: unknown };
export type FetchPageResult = { records: FetchedRecord[]; nextCursor: unknown | null };
export type NormalizeResult =
  | { opportunity: OpportunityUpsert; items: OpportunityItemUpsert[]; documents: DocumentRef[] }
  | { skip: string };

export interface SourceConnector {
  /** = Source.key */
  key: string;
  fetchPage(cursor: unknown | null): Promise<FetchPageResult>;
  /** Função pura: mesmo payload → mesmo resultado (inclusive `contentHash`). */
  normalize(payload: unknown): NormalizeResult;
}

/**
 * Capacidades extras usadas pela sincronização (T-202). Opcionais para manter a interface mínima
 * de CONTRACTS §5 intacta.
 */
export interface SyncableConnector extends SourceConnector {
  /** Definição do registro `sources` (não secreta). */
  definition: {
    name: string;
    kind: 'api' | 'scraper' | 'manual_upload' | 'email';
    baseUrl: string | null;
    rateLimit: { requestsPerMinute: number; maxConcurrency: number };
    config: Record<string, unknown>;
  };
  /** Cursor inicial a partir de uma data (backfill ou primeira sincronização). */
  cursorFrom(since: Date | null): unknown;
  /** Ajusta um cursor salvo ao momento atual (ex.: estende o limite até hoje). `null` = cursor inválido. */
  resumeCursor(saved: unknown): unknown | null;
  /** Completa o payload (itens, documentos). Chamado só para registros relevantes. */
  enrich?(payload: unknown): Promise<unknown>;
  /** O payload já está completo (enriquecido)? */
  isEnriched?(payload: unknown): boolean;
  /** Parte do payload que vem da listagem (sem enriquecimento), para detectar mudança na fonte. */
  listingOf?(payload: unknown): unknown;
}
