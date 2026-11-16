/**
 * Situação efetiva da oportunidade (ADR-018).
 *
 * `Opportunity.status` guarda só o que a fonte informa. Para exibição e filtro, `published` com
 * `proposalsCloseAt` é derivada do relógio: futuro → `receiving_proposals`, alcançado/passado → `closed`.
 * `published` sem data de encerramento continua `published`. Qualquer outro status passa direto.
 *
 * `effectiveStatus` (JS) e `effectiveStatusCondition` (SQL) implementam a MESMA regra; o teste de
 * integração compara as duas sobre uma grade de casos. Comparação por instante (timestamptz): o fuso
 * America/Sao_Paulo só importa para exibição, não para a comparação.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { OpportunityView } from '@/contracts/api';
import { opportunities } from '../../db/schema';

export type EffectiveStatus = OpportunityView['status'];

export function effectiveStatus(o: { status: EffectiveStatus; proposalsCloseAt: Date | string | null }, now: Date): EffectiveStatus {
  if (o.status !== 'published' || o.proposalsCloseAt === null) return o.status;
  return new Date(o.proposalsCloseAt).getTime() > now.getTime() ? 'receiving_proposals' : 'closed';
}

type Columns = { status: SQL.Aliased | typeof opportunities.status; closeAt: typeof opportunities.proposalsCloseAt };

/** Condição SQL: a oportunidade tem situação efetiva em `statuses` no instante `now`. */
export function effectiveStatusCondition(statuses: readonly EffectiveStatus[], now: Date, cols: Columns = { status: opportunities.status, closeAt: opportunities.proposalsCloseAt }): SQL {
  const instant = sql`${now.toISOString()}::timestamptz`;
  const parts = [...new Set(statuses)].map((v): SQL => {
    switch (v) {
      case 'receiving_proposals':
        return sql`(${cols.status} = 'receiving_proposals' or (${cols.status} = 'published' and ${cols.closeAt} > ${instant}))`;
      case 'closed':
        return sql`(${cols.status} = 'closed' or (${cols.status} = 'published' and ${cols.closeAt} <= ${instant}))`;
      case 'published':
        return sql`(${cols.status} = 'published' and ${cols.closeAt} is null)`;
      default:
        return sql`${cols.status} = ${v}`;
    }
  });
  if (!parts.length) return sql`true`;
  return sql`(${sql.join(parts, sql` or `)})`;
}
