/**
 * recordAudit — único ponto de escrita da trilha (T-108).
 * - Use dentro da MESMA transação da escrita de negócio (passe o `tx`): se a auditoria falhar, a escrita falha.
 * - `recordAuditSafe` (melhor esforço) só para eventos de segurança fora de transação (login, logout, negação).
 */
import { auditActorType, auditOutcome } from '../../contracts';
import type { Db } from '../db';
import { auditEvents } from '../db/schema';

type Executor = Pick<Db, 'insert'>;

export type AuditInput = {
  action: string;
  outcome: 'success' | 'denied' | 'failure';
  actorType?: 'user' | 'system' | 'job';
  actorUserId?: string | null;
  companyId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  ipHash?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

const SENSITIVE = /pass(word)?|senha|secret|segredo|token|cookie|authorization|api[_-]?key|credential|cpf/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;

/** Remove chaves sensíveis e limita tamanho/profundidade. Exportada para teste. */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (depth >= MAX_DEPTH) return '[profundidade]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeMetadata(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[k] = SENSITIVE.test(k) ? '[removido]' : sanitizeMetadata(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export async function recordAudit(db: Executor, input: AuditInput): Promise<void> {
  if (!/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/.test(input.action)) throw new Error(`ação de auditoria inválida: ${input.action}`);
  await db.insert(auditEvents).values({
    action: input.action,
    outcome: auditOutcome.parse(input.outcome),
    actorType: auditActorType.parse(input.actorType ?? (input.actorUserId ? 'user' : 'system')),
    actorUserId: input.actorUserId ?? null,
    companyId: input.companyId ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    ipHash: input.ipHash ?? null,
    requestId: input.requestId ?? null,
    metadata: sanitizeMetadata(input.metadata ?? {}) as Record<string, unknown>,
  });
}

export async function recordAuditSafe(db: Executor, input: AuditInput): Promise<void> {
  try {
    await recordAudit(db, input);
  } catch (e) {
    console.error('[audit] falha ao registrar', input.action, e instanceof Error ? e.message : e);
  }
}
