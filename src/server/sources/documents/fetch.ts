/**
 * `document.fetch` (T-203): baixa o arquivo de um documento PÚBLICO de edital e o guarda no Object Storage.
 *
 * - Só documentos públicos de origem `source` (sem `companyId`) com `sourceUrl`; certidões e uploads privados
 *   seguem outro caminho (T-212) e nunca passam por aqui.
 * - Idempotente: documento com `fetchedAt` preenchido não é baixado de novo; o objeto é endereçado pelo hash
 *   (`public/<opportunityId>/<sha256>.<ext>`), então repetir o `put` regrava os mesmos bytes.
 * - Rejeição definitiva (URL fora da origem, endereço privado, grande demais, tipo não permitido, 404) NÃO lança:
 *   grava `AuditEvent` (`document.fetch_rejected`) e termina, para o pg-boss não retentar o que não muda.
 * - Falha passageira (rede, 5xx, timeout) lança: o pg-boss retenta (3 tentativas, backoff).
 * - HTTP 429 nunca é retentado: reenfileira o MESMO job depois do cooldown.
 * - Sucesso: atualiza só `storageKey`, `sha256`, `sizeBytes`, `mimeType` e `fetchedAt` (campos do agente 02) e enfileira
 *   `document.extract` (agente 03) na MESMA transação, para formatos com texto extraível.
 */
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { recordAudit } from '../../audit';
import * as s from '../../db/schema';
import { enqueueWith } from '../../jobs/enqueue';
import { log } from '../../jobs/registry';
import { publicKey, sha256Hex, type ObjectStorage } from '../../storage';
import { DocumentRateLimited, DocumentRejected, downloadDocument, sniffDocument, type DownloadDeps } from './download';

export type FetchDocumentDeps = {
  pool: Pool;
  boss: PgBoss;
  storage: ObjectStorage;
  download?: DownloadDeps;
  now?: () => Date;
};

export type FetchDocumentOutcome =
  | { status: 'stored'; storageKey: string | null; sizeBytes: number; mimeType: string; duplicateOf?: string }
  | { status: 'already_done' | 'missing' | 'not_applicable' }
  | { status: 'rejected'; reason: string }
  | { status: 'rate_limited'; retryAfterMs: number };

const UNIQUE_VIOLATION = '23505';

export async function fetchDocument(deps: FetchDocumentDeps, documentId: string): Promise<FetchDocumentOutcome> {
  const db = drizzle(deps.pool, { schema: s, casing: 'snake_case' });
  const [doc] = await db.select().from(s.documents).where(eq(s.documents.id, documentId)).limit(1);
  if (!doc) return { status: 'missing' };
  if (doc.companyId !== null || doc.origin !== 'source' || !doc.sourceUrl || !doc.opportunityId) return { status: 'not_applicable' };
  if (doc.fetchedAt !== null) return { status: 'already_done' };
  const opportunityId = doc.opportunityId;

  const rejeitar = async (reason: string, message: string): Promise<FetchDocumentOutcome> => {
    await recordAudit(db, {
      action: 'document.fetch_rejected',
      outcome: 'failure',
      actorType: 'job',
      entityType: 'document',
      entityId: doc.id,
      // Só o host (sem caminho/consulta) e o motivo: a URL completa pode carregar identificadores da fonte.
      metadata: { reason, message, host: safeHost(doc.sourceUrl!) },
    });
    log('warn', 'document.fetch_rejected', { documentId: doc.id, reason });
    return { status: 'rejected', reason };
  };

  let baixado;
  try {
    baixado = await downloadDocument(doc.sourceUrl, deps.download);
  } catch (error) {
    if (error instanceof DocumentRateLimited) {
      // Nunca retenta o 429: retoma o mesmo job depois do cooldown.
      await enqueueWith(deps.boss, 'document.fetch', { documentId }, { startAfter: new Date(Date.now() + error.cooldownMs) });
      log('warn', 'document.fetch_rate_limited', { documentId, cooldownMs: error.cooldownMs });
      return { status: 'rate_limited', retryAfterMs: error.cooldownMs };
    }
    if (error instanceof DocumentRejected) return rejeitar(error.reason, error.message);
    throw error; // transitório: pg-boss retenta
  }

  const tipo = sniffDocument(baixado.bytes, doc.title);
  if (!tipo) return rejeitar('mime_not_allowed', 'conteúdo não corresponde a um tipo de documento permitido');

  const sha256 = sha256Hex(baixado.bytes);
  const storageKey = publicKey(opportunityId, sha256, tipo.ext);
  await deps.storage.put(storageKey, baixado.bytes, tipo.mime);

  const fetchedAt = (deps.now ?? (() => new Date()))();
  const client = await deps.pool.connect();
  try {
    await client.query('begin');
    const tx = drizzle(client, { schema: s, casing: 'snake_case' });
    const [atual] = await tx.select({ fetchedAt: s.documents.fetchedAt }).from(s.documents).where(eq(s.documents.id, doc.id)).for('update');
    if (!atual || atual.fetchedAt !== null) {
      await client.query('rollback');
      return { status: 'already_done' };
    }
    const campos = { sha256, sizeBytes: baixado.bytes.byteLength, mimeType: tipo.mime, fetchedAt, updatedAt: sql`now()` };
    let guardada: string | null = storageKey;
    let duplicateOf: string | undefined;
    await client.query('savepoint gravar');
    try {
      await tx.update(s.documents).set({ ...campos, storageKey }).where(eq(s.documents.id, doc.id));
    } catch (error) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      // Outro documento da mesma oportunidade tem exatamente os mesmos bytes (mesma chave, que é única).
      // Registra o arquivo como baixado, sem apontar a mesma chave duas vezes.
      await client.query('rollback to savepoint gravar');
      guardada = null;
      const [dono] = await tx.select({ id: s.documents.id }).from(s.documents).where(eq(s.documents.storageKey, storageKey)).limit(1);
      duplicateOf = dono?.id;
      await tx.update(s.documents).set({ ...campos, storageKey: null }).where(eq(s.documents.id, doc.id));
    }
    if (tipo.extractable && guardada) await enqueueWith(deps.boss, 'document.extract', { documentId: doc.id }, { tx: client });
    await client.query('commit');
    log('info', 'document.fetched', { documentId: doc.id, sizeBytes: baixado.bytes.byteLength, mimeType: tipo.mime, duplicate: Boolean(duplicateOf) });
    return { status: 'stored', storageKey: guardada, sizeBytes: baixado.bytes.byteLength, mimeType: tipo.mime, ...(duplicateOf ? { duplicateOf } : {}) };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalida';
  }
}
