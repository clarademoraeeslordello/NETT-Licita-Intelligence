/**
 * Índice de busca textual das oportunidades (T-215, ADR-024).
 *
 * A tabela `opportunity_search` guarda um texto derivado (minúsculas, sem acento) por oportunidade, com
 * índice GIN de trigramas. O texto é normalizado AQUI, no app (não há `unaccent` no SQL); o `q` da consulta
 * passa pela mesma função antes do `LIKE`. Mudou `normalizeSearchText` ou os campos do texto → rode
 * `rebuildSearchIndex` (o `source.normalize` só regrava linhas de oportunidades que ele toca).
 *
 * Escrita: `source.normalize`, na MESMA transação da oportunidade (ver normalize-record.ts).
 */
import { and, asc, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db';
import { opportunities, opportunitySearch } from '../../db/schema';

/** Limite do texto indexado por oportunidade (objetos muito longos não melhoram a busca e incham o índice). */
export const MAX_SEARCH_TEXT = 20_000;

/** Minúsculas, sem acento, espaços colapsados. Usada na escrita E na consulta. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export type SearchSource = {
  title: string;
  objectDescription: string;
  agencyName: string;
  agencyUnit?: string | null;
  municipality?: string | null;
};

/** Texto indexado: título, objeto, órgão, unidade e município. */
export function buildSearchText(o: SearchSource): string {
  return normalizeSearchText([o.title, o.objectDescription, o.agencyName, o.agencyUnit, o.municipality].filter(Boolean).join(' ')).slice(0, MAX_SEARCH_TEXT);
}

/** Palavras da consulta (até 8), já normalizadas. TODAS precisam aparecer, em qualquer ordem. */
export const searchTokens = (q: string): string[] => normalizeSearchText(q).split(' ').filter(Boolean).slice(0, 8);

type Writer = Pick<Db, 'insert'>;

/** Grava (ou atualiza, só se mudou) o texto de busca de uma oportunidade. Chamar dentro da transação do normalize. */
export async function upsertSearchText(db: Writer, opportunityId: string, searchText: string): Promise<void> {
  await db
    .insert(opportunitySearch)
    .values({ opportunityId, searchText })
    .onConflictDoUpdate({
      target: opportunitySearch.opportunityId,
      set: { searchText: sql`excluded.search_text`, updatedAt: sql`now()` },
      setWhere: sql`${opportunitySearch.searchText} is distinct from excluded.search_text`,
    });
}

export type BackfillResult = { scanned: number; written: number; batches: number };

/**
 * Preenche o índice. Idempotente e retomável (pode ser interrompido e repetido).
 *  - `missing` (padrão): só oportunidades sem linha.
 *  - `rebuild`: recalcula todas (após mudar a normalização), por chave `id`.
 */
export async function backfillSearchIndex(db: Db, opts: { mode?: 'missing' | 'rebuild'; batchSize?: number } = {}): Promise<BackfillResult> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 500, 1), 5000);
  const result: BackfillResult = { scanned: 0, written: 0, batches: 0 };
  let after: string | null = null;
  for (;;) {
    const rows = await db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        objectDescription: opportunities.objectDescription,
        agencyName: opportunities.agencyName,
        agencyUnit: opportunities.agencyUnit,
        municipality: opportunities.municipality,
      })
      .from(opportunities)
      .leftJoin(opportunitySearch, sql`${opportunitySearch.opportunityId} = ${opportunities.id}`)
      .where(
        and(
          opts.mode === 'rebuild' ? undefined : isNull(opportunitySearch.opportunityId),
          after ? gt(opportunities.id, after) : undefined,
        ),
      )
      .orderBy(asc(opportunities.id))
      .limit(batchSize);
    if (!rows.length) return result;
    await db.transaction(async (tx) => {
      for (const r of rows) await upsertSearchText(tx, r.id, buildSearchText(r));
    });
    result.scanned += rows.length;
    result.written += rows.length;
    result.batches += 1;
    after = rows.at(-1)!.id;
    if (rows.length < batchSize) return result;
  }
}

/** Quantas oportunidades ainda não têm linha no índice (deve ser 0 depois do backfill). */
export async function missingSearchRows(db: Db): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(opportunities)
    .leftJoin(opportunitySearch, sql`${opportunitySearch.opportunityId} = ${opportunities.id}`)
    .where(isNull(opportunitySearch.opportunityId));
  return r?.n ?? 0;
}
