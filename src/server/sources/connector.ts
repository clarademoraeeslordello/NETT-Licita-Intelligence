/**
 * Interface dos conectores de fonte (CONTRACTS.md §5) e tipos de saída da normalização.
 *
 * `OpportunityUpsert`, `OpportunityItemUpsert` e `DocumentRef` são DERIVADOS dos schemas canônicos
 * (`src/contracts`) — não redefinem entidades. Proposta ao agente 01: mover estas derivações para
 * `src/contracts/sources.ts` (CONTRACTS.md §5 prevê a derivação no PR de T-201).
 */
import { z } from 'zod';
import { document } from '@/contracts/documents';
import { opportunity, opportunityItem } from '@/contracts/sources';

/** Campos que o pipeline de persistência (T-202) define: identidade, fonte primária, datas de visto. */
export const opportunityUpsert = opportunity.omit({
  id: true,
  primarySourceId: true,
  firstSeenAt: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
});
export type OpportunityUpsert = z.infer<typeof opportunityUpsert>;

export const opportunityItemUpsert = opportunityItem.omit({ id: true, opportunityId: true });
export type OpportunityItemUpsert = z.infer<typeof opportunityItemUpsert>;

/**
 * Referência a documento público da fonte, antes do download (T-203 baixa, mede e armazena).
 * `document` tem refinements (Zod 4 não permite .pick), por isso a derivação usa `.shape`.
 */
export const documentRef = z.object({
  /** Identificador do documento na fonte (ex.: sequencialDocumento do PNCP). */
  externalId: z.string().min(1),
  kind: document.shape.kind,
  title: document.shape.title,
  sourceUrl: z.url(),
  /** Inferido pelo nome; confirmado no download (T-203). */
  mimeType: document.shape.mimeType,
  publishedAt: document.shape.fetchedAt,
});
export type DocumentRef = z.infer<typeof documentRef>;

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
