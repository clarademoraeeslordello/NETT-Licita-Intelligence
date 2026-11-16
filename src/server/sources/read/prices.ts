/**
 * /api/v1/prices — preços homologados (OpportunityItem com resultado) por descrição e UF.
 * Dados públicos. Só itens com `awarded_unit_value` entram; o resumo (mín/mediana/máx) cobre TODAS as
 * amostras da busca, não só a página.
 *
 * Observação: os campos homologados são preenchidos pela coleta de resultados (ainda não implementada
 * em T-202). Até lá a rota devolve apenas o que existir no banco.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PricePage, PriceQuery } from '@/contracts/api';
import type { Db } from '../../db';
import { decodeCursor, encodeCursor } from './cursor';
import { EPOCH_ISO, escapeLike } from './opportunities';

type PriceRow = Record<string, unknown> & {
  item_id: string;
  opportunity_id: string;
  description: string;
  unit: string;
  quantity: string;
  estimated_unit_value: string | null;
  awarded_unit_value: string;
  discount_percent: string | null;
  supplier_cnpj: string | null;
  supplier_name: string | null;
  awarded_at: Date | null;
  sort_key: Date;
  agency_name: string;
  municipality: string | null;
  uf: string | null;
  modality_name: string | null;
  url: string;
};

const SORT = 'awarded_desc';

export async function listPrices(db: Db, q: PriceQuery): Promise<PricePage> {
  // Todas as palavras (até 8), sem acento/caixa NÃO normalizados: ILIKE literal. Sem índice próprio ainda — o conjunto
  // já é restrito a itens com resultado homologado (T-214 popula; indexar lá, quando houver volume).
  const palavras = q.q.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const base: SQL[] = [sql`i.awarded_unit_value is not null`, ...palavras.map((t) => sql`i.description ilike ${`%${escapeLike(t)}%`}`)];
  if (q.ufs) base.push(sql`o.uf in (${sql.join(q.ufs.map((u) => sql`${u}::uf`), sql`, `)})`);
  const baseWhere = sql.join(base, sql` and `);

  const [summary] = (
    await db.execute(sql`
      select count(*)::int as count,
             round(min(i.awarded_unit_value), 4)::text as min,
             round((percentile_cont(0.5) within group (order by i.awarded_unit_value))::numeric, 4)::text as median,
             round(max(i.awarded_unit_value), 4)::text as max
        from opportunity_items i join opportunities o on o.id = i.opportunity_id
       where ${baseWhere}`)
  ).rows as Array<{ count: number; min: string | null; median: string | null; max: string | null }>;

  const page: SQL[] = [baseWhere];
  if (q.cursor) {
    const c = decodeCursor(q.cursor, SORT);
    page.push(sql`(coalesce(i.awarded_at, ${EPOCH_ISO}::timestamptz), i.id) < (${c.k ?? EPOCH_ISO}::timestamptz, ${c.id}::uuid)`);
  }
  const rows = (
    await db.execute(sql`
      select i.id as item_id, i.opportunity_id, i.description, i.unit,
             i.quantity::text as quantity,
             i.estimated_unit_value::text as estimated_unit_value,
             i.awarded_unit_value::text as awarded_unit_value,
             round((i.estimated_unit_value - i.awarded_unit_value) / nullif(i.estimated_unit_value, 0) * 100, 2)::text as discount_percent,
             i.awarded_supplier_cnpj as supplier_cnpj, i.awarded_supplier_name as supplier_name, i.awarded_at,
             coalesce(i.awarded_at, ${EPOCH_ISO}::timestamptz) as sort_key,
             o.agency_name, o.municipality, o.uf::text as uf, o.modality_name, o.url
        from opportunity_items i join opportunities o on o.id = i.opportunity_id
       where ${sql.join(page, sql` and `)}
       order by sort_key desc, i.id desc
       limit ${q.limit + 1}`)
  ).rows as PriceRow[];

  const pageRows = rows.slice(0, q.limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((r) => ({
      itemId: r.item_id,
      opportunityId: r.opportunity_id,
      description: r.description,
      unit: r.unit,
      quantity: r.quantity,
      estimatedUnitValue: r.estimated_unit_value,
      awardedUnitValue: r.awarded_unit_value,
      discountPercent: r.discount_percent,
      supplierCnpj: r.supplier_cnpj,
      supplierName: r.supplier_name,
      awardedAt: r.awarded_at ? new Date(r.awarded_at).toISOString() : null,
      agencyName: r.agency_name,
      municipality: r.municipality,
      uf: r.uf as PricePage['items'][number]['uf'],
      modalityName: r.modality_name,
      url: r.url,
    })),
    nextCursor: rows.length > q.limit && last ? encodeCursor({ s: SORT, k: r2iso(last.sort_key), id: last.item_id }) : null,
    summary: { count: summary?.count ?? 0, min: summary?.min ?? null, median: summary?.median ?? null, max: summary?.max ?? null },
  };
}

const r2iso = (d: Date) => new Date(d).toISOString();
