/**
 * AuditEvent — trilha APPEND-ONLY de ações relevantes (T-108). Suporte, adicionado em 1.1.0.
 * Escrita: somente via `recordAudit()` (src/server/audit, agente 01). Leitura: nett_admin.
 * Proibido em `metadata`: tokens, senhas, cookies, conteúdo de documentos, dados pessoais além do necessário.
 */
import { z } from 'zod';
import { isoDateTime, sha256, uuid } from './common';

export const auditActorType = z.enum(['user', 'system', 'job']);
export const auditOutcome = z.enum(['success', 'denied', 'failure']);

export const auditEvent = z.object({
  id: uuid,
  occurredAt: isoDateTime,
  actorType: auditActorType,
  actorUserId: uuid.nullable(),
  companyId: uuid.nullable(),
  /** Verbo em notação "dominio.acao", ex.: "auth.login", "authz.denied", "review.created". */
  action: z.string().regex(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  outcome: auditOutcome,
  /** HMAC do IP (nunca o IP em claro). */
  ipHash: sha256.nullable(),
  requestId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof auditEvent>;
