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
