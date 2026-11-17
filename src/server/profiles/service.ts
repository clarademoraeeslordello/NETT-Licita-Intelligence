/**
 * SearchProfile e CompanyCapability por empresa (T-216). Toda leitura e escrita é filtrada por `companyId`
 * (vem do caminho, já autorizado pelo chamador): um id de outra empresa é indistinguível de um id inexistente (404).
 *
 * Reprocesso: `match.profile` é o ÚNICO gatilho que reavalia as oportunidades abertas contra um perfil criado ou
 * alterado (ADR-025). Guarda "sem perfil ativo": só se enfileira quando o perfil resultante está ATIVO, a empresa está
 * ativa e algo que muda a nota ou quem casa mudou. Desativar um perfil não enfileira nada; as notas dele deixam de
 * aparecer porque as leituras (`getMatchSummaries`, radar) só consideram perfis ativos.
 */
import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq, sql } from 'drizzle-orm';
import { companyCapability, type CompanyCapability, type SearchProfile } from '../../contracts';
import { notFound, unprocessable } from '../http/errors';
import { recordAudit, recordAuditSafe } from '../audit';
import type { Db } from '../db';
import { companies, companyCapabilities, documents, searchProfiles } from '../db/schema';
import { tokens } from '../analysis/fit/text';
import { toSearchProfile } from '../matching/service';
import { capabilityRules, MATCH_FIELDS, valueRangeOk, type CapabilityCreate, type CapabilityPatch, type ListQuery, type SearchProfileCreate, type SearchProfilePatch } from './dto';

export type Ctx = { ipHash: string | null; requestId: string | null };
export type Page<T> = { items: T[]; nextCursor: string | null };

/** Resultado do gatilho `match.profile`, devolvido ao cliente. */
export type Reprocess = 'queued' | 'skipped_inactive_profile' | 'skipped_inactive_company' | 'skipped_unchanged' | 'failed';
export type EnqueueProfile = (searchProfileId: string) => Promise<unknown>;

const iso = (d: Date) => d.toISOString();

/* --------------------------------- cursor --------------------------------- */

const CURSOR_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encodeCursor = (ts: string, id: string) => Buffer.from(JSON.stringify([ts, id])).toString('base64url');
function decodeCursor(cursor: string): { ts: string; id: string } {
  try {
    const [ts, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [unknown, unknown];
    if (typeof ts === 'string' && typeof id === 'string' && CURSOR_TS.test(ts) && UUID.test(id)) return { ts, id };
  } catch {
    /* cai no erro abaixo */
  }
  throw unprocessable('Cursor inválido.');
}

/* ------------------------- guarda do reprocesso --------------------------- */

const DECIMAL_FIELDS = new Set(['minValue', 'maxValue', 'maxContractValue']);
/** Igualdade de campo: listas sem ordem; decimais por valor ("1000" == "1000.0000", como o banco devolve). */
const sameField = (key: string, a: unknown, b: unknown) => {
  if (DECIMAL_FIELDS.has(key)) return a === null || b === null ? a === b : Number(a) === Number(b);
  return Array.isArray(a) && Array.isArray(b) ? isDeepStrictEqual([...a].map(String).sort(), [...b].map(String).sort()) : isDeepStrictEqual(a, b);
};

/** Termos são comparados como o casamento os enxerga (`tokens`: sem caixa, sem acento, radical), nunca como texto cru. */
const TERM_FIELDS = new Set<string>(['includeTerms', 'excludeTerms']);
const asMatcherSees = (field: string, v: unknown) => (TERM_FIELDS.has(field) && Array.isArray(v) ? v.map((t) => tokens(String(t)).join(' ')) : v);

/**
 * Quais campos que afetam o match diferem entre os dois perfis. Termos e UFs não dependem da ordem, e termos são
 * comparados pela forma normalizada do casamento (eligibility.ts): trocar "LGPD" por "lgpd" grava mas não reprocessa.
 */
export const changedMatchFields = (before: SearchProfile, after: SearchProfile) => MATCH_FIELDS.filter((f) => !sameField(f, asMatcherSees(f, before[f]), asMatcherSees(f, after[f])));

/**
 * Guarda "sem perfil ativo" (pura, testável sem banco). `before = null` na criação.
 *  - perfil inativo → nada a reavaliar (as notas dele já não são lidas);
 *  - empresa inativa → o handler descartaria de qualquer forma;
 *  - reativação ou mudança em campo que afeta o match → reprocessa;
 *  - mudança só de nome, nota mínima ou canal de alerta → não reprocessa.
 */
export function reprocessDecision(before: SearchProfile | null, after: SearchProfile, companyActive: boolean): 'queue' | Exclude<Reprocess, 'queued' | 'failed'> {
  if (!after.active) return 'skipped_inactive_profile';
  if (!companyActive) return 'skipped_inactive_company';
  if (before === null || !before.active) return 'queue';
  return changedMatchFields(before, after).length > 0 ? 'queue' : 'skipped_unchanged';
}

/** Enfileira DEPOIS do commit. Falha do enfileiramento não desfaz o perfil: devolve 'failed' e audita. */
async function triggerReprocess(db: Db, enqueue: EnqueueProfile, p: { profile: SearchProfile; decision: ReturnType<typeof reprocessDecision>; actorUserId: string; ctx: Ctx }): Promise<Reprocess> {
  if (p.decision !== 'queue') return p.decision;
  try {
    await enqueue(p.profile.id);
    return 'queued';
  } catch (e) {
    console.error('match.profile: falha ao enfileirar', { searchProfileId: p.profile.id, error: e instanceof Error ? e.name : 'erro' });
    await recordAuditSafe(db, {
      action: 'search_profile.reprocess_failed',
      outcome: 'failure',
      actorUserId: p.actorUserId,
      companyId: p.profile.companyId,
      entityType: 'search_profile',
      entityId: p.profile.id,
      ipHash: p.ctx.ipHash,
      requestId: p.ctx.requestId,
    });
    return 'failed';
  }
}

/* ------------------------------ SearchProfile ----------------------------- */

const pageSql = (table: typeof searchProfiles | typeof companyCapabilities, cursor: { ts: string; id: string } | null) =>
  cursor ? sql`(${table.createdAt}, ${table.id}) > (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : undefined;

export async function listSearchProfiles(db: Db, companyId: string, q: ListQuery): Promise<Page<SearchProfile>> {
  const after = q.cursor ? decodeCursor(q.cursor) : null;
  const rows = await db
    .select({ row: searchProfiles, ts: sql<string>`${searchProfiles.createdAt}::text` })
    .from(searchProfiles)
    .where(and(eq(searchProfiles.companyId, companyId), q.active === undefined ? undefined : eq(searchProfiles.active, q.active), pageSql(searchProfiles, after)))
    .orderBy(asc(searchProfiles.createdAt), asc(searchProfiles.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return { items: page.map((r) => toSearchProfile(r.row)), nextCursor: rows.length > q.limit && last ? encodeCursor(last.ts, last.row.id) : null };
}

export async function getSearchProfile(db: Db, companyId: string, id: string): Promise<SearchProfile> {
  const [row] = await db.select().from(searchProfiles).where(and(eq(searchProfiles.id, id), eq(searchProfiles.companyId, companyId)));
  if (!row) throw notFound('Perfil de busca não encontrado.');
  return toSearchProfile(row);
}

export type ProfileResult = { profile: SearchProfile; reprocess: Reprocess };

export async function createSearchProfile(db: Db, enqueue: EnqueueProfile, p: { companyId: string; actorUserId: string; input: SearchProfileCreate; ctx: Ctx }): Promise<ProfileResult> {
  const { profile, companyActive } = await db.transaction(async (tx) => {
    const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, p.companyId));
    if (!company) throw notFound('Empresa não encontrada.');
    const [row] = await tx.insert(searchProfiles).values({ ...p.input, companyId: p.companyId, ownerUserId: p.actorUserId }).returning();
    if (!row) throw new Error('search_profiles: insert não retornou linha');
    await recordAudit(tx, {
      action: 'search_profile.created',
      outcome: 'success',
      actorUserId: p.actorUserId,
      companyId: p.companyId,
      entityType: 'search_profile',
      entityId: row.id,
      ipHash: p.ctx.ipHash,
      requestId: p.ctx.requestId,
      // Só contagens: termos de busca revelam a estratégia comercial da empresa.
      metadata: { active: row.active, includeTerms: row.includeTerms.length, excludeTerms: row.excludeTerms.length },
    });
    return { profile: toSearchProfile(row), companyActive: company.status === 'active' };
  });
  const decision = reprocessDecision(null, profile, companyActive);
  return { profile, reprocess: await triggerReprocess(db, enqueue, { profile, decision, actorUserId: p.actorUserId, ctx: p.ctx }) };
}

export async function updateSearchProfile(db: Db, enqueue: EnqueueProfile, p: { companyId: string; id: string; actorUserId: string; patch: SearchProfilePatch; ctx: Ctx }): Promise<ProfileResult> {
  const out = await db.transaction(async (tx) => {
    // FOR UPDATE: dois PATCH concorrentes do mesmo perfil se serializam e a faixa de valores é validada contra o estado real.
    const [row] = await tx.select().from(searchProfiles).where(and(eq(searchProfiles.id, p.id), eq(searchProfiles.companyId, p.companyId))).for('update');
    if (!row) throw notFound('Perfil de busca não encontrado.');
    const before = toSearchProfile(row);
    const set = Object.fromEntries(Object.entries(p.patch).filter(([k, v]) => v !== undefined && !sameField(k, (before as Record<string, unknown>)[k], v)));
    const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, p.companyId));
    const companyActive = company?.status === 'active';
    if (Object.keys(set).length === 0) return { before, after: before, companyActive, changed: [] as string[] }; // nada mudou: não grava, não audita, não reprocessa
    if (!valueRangeOk({ ...before, ...set })) throw unprocessable('minValue deve ser <= maxValue.');
    const [updated] = await tx.update(searchProfiles).set(set).where(and(eq(searchProfiles.id, p.id), eq(searchProfiles.companyId, p.companyId))).returning();
    if (!updated) throw new Error('search_profiles: update não retornou linha');
    const after = toSearchProfile(updated);
    await recordAudit(tx, {
      action: 'search_profile.updated',
      outcome: 'success',
      actorUserId: p.actorUserId,
      companyId: p.companyId,
      entityType: 'search_profile',
      entityId: p.id,
      ipHash: p.ctx.ipHash,
      requestId: p.ctx.requestId,
      metadata: { fields: Object.keys(set), active: after.active },
    });
    return { before, after, companyActive, changed: Object.keys(set) };
  });
  const decision = out.changed.length === 0 ? 'skipped_unchanged' : reprocessDecision(out.before, out.after, out.companyActive);
  return { profile: out.after, reprocess: await triggerReprocess(db, enqueue, { profile: out.after, decision, actorUserId: p.actorUserId, ctx: p.ctx }) };
}

/* ---------------------------- CompanyCapability --------------------------- */

export function toCapability(row: typeof companyCapabilities.$inferSelect): CompanyCapability {
  return companyCapability.parse({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });
}

/** O documento de evidência precisa ser desta empresa (o FK composto também garante, mas aqui o erro é claro). */
async function assertEvidence(db: Pick<Db, 'select'>, companyId: string, documentId: string | null | undefined) {
  if (!documentId) return;
  const [d] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));
  if (!d) throw unprocessable('Documento de evidência não encontrado nesta empresa.', [{ path: 'evidenceDocumentId', message: 'documento inexistente para esta empresa' }]);
}

export async function listCapabilities(db: Db, companyId: string, q: ListQuery): Promise<Page<CompanyCapability>> {
  const after = q.cursor ? decodeCursor(q.cursor) : null;
  const rows = await db
    .select({ row: companyCapabilities, ts: sql<string>`${companyCapabilities.createdAt}::text` })
    .from(companyCapabilities)
    .where(and(eq(companyCapabilities.companyId, companyId), q.active === undefined ? undefined : eq(companyCapabilities.active, q.active), pageSql(companyCapabilities, after)))
    .orderBy(asc(companyCapabilities.createdAt), asc(companyCapabilities.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return { items: page.map((r) => toCapability(r.row)), nextCursor: rows.length > q.limit && last ? encodeCursor(last.ts, last.row.id) : null };
}

export async function getCapability(db: Db, companyId: string, id: string): Promise<CompanyCapability> {
  const [row] = await db.select().from(companyCapabilities).where(and(eq(companyCapabilities.id, id), eq(companyCapabilities.companyId, companyId)));
  if (!row) throw notFound('Capacidade não encontrada.');
  return toCapability(row);
}

export async function createCapability(db: Db, p: { companyId: string; actorUserId: string; input: CapabilityCreate; ctx: Ctx }): Promise<CompanyCapability> {
  await assertEvidence(db, p.companyId, p.input.evidenceDocumentId);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(companyCapabilities).values({ ...p.input, companyId: p.companyId }).returning();
    if (!row) throw new Error('company_capabilities: insert não retornou linha');
    await recordAudit(tx, {
      action: 'capability.created',
      outcome: 'success',
      actorUserId: p.actorUserId,
      companyId: p.companyId,
      entityType: 'company_capability',
      entityId: row.id,
      ipHash: p.ctx.ipHash,
      requestId: p.ctx.requestId,
      metadata: { kind: row.kind, subject: row.subject, active: row.active },
    });
    return toCapability(row);
  });
}

export async function updateCapability(db: Db, p: { companyId: string; id: string; actorUserId: string; patch: CapabilityPatch; ctx: Ctx }): Promise<CompanyCapability> {
  await assertEvidence(db, p.companyId, p.patch.evidenceDocumentId);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(companyCapabilities).where(and(eq(companyCapabilities.id, p.id), eq(companyCapabilities.companyId, p.companyId))).for('update');
    if (!row) throw notFound('Capacidade não encontrada.');
    const before = toCapability(row);
    const set = Object.fromEntries(Object.entries(p.patch).filter(([k, v]) => v !== undefined && !sameField(k, (before as Record<string, unknown>)[k], v)));
    if (Object.keys(set).length === 0) return before;
    const rule = capabilityRules({ ...before, ...set });
    if (rule) throw unprocessable(rule);
    const [updated] = await tx.update(companyCapabilities).set(set).where(and(eq(companyCapabilities.id, p.id), eq(companyCapabilities.companyId, p.companyId))).returning();
    if (!updated) throw new Error('company_capabilities: update não retornou linha');
    await recordAudit(tx, {
      action: 'capability.updated',
      outcome: 'success',
      actorUserId: p.actorUserId,
      companyId: p.companyId,
      entityType: 'company_capability',
      entityId: p.id,
      ipHash: p.ctx.ipHash,
      requestId: p.ctx.requestId,
      metadata: { fields: Object.keys(set), active: updated.active },
    });
    return toCapability(updated);
  });
}
