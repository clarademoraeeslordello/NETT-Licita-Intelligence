/**
 * Document — metadados; o binário vive no Object Storage.
 * companyId null  => documento público de licitação (compartilhável entre empresas).
 * companyId !null => documento privado da empresa (certidão, proposta, relatório).
 * Escrita: agente 02 (captura/upload/armazenamento) e agente 03 (textStatus, page count).
 */
import { z } from 'zod';
import { isoDate, isoDateTime, sha256, timestamps, uuid } from './common';

export const documentKind = z.enum([
  'tender_notice',
  'annex',
  'reference_term',
  'price_map',
  'minutes',
  'company_certificate',
  'proposal',
  'report',
  'other',
]);
export const documentOrigin = z.enum(['source', 'upload', 'generated']);
export const textStatus = z.enum(['pending', 'extracted', 'no_text_layer', 'error']);
export const certificateCategory = z.enum(['fiscal', 'trabalhista', 'juridica', 'economica', 'tecnica']);

export const document = z
  .object({
    id: uuid,
    companyId: uuid.nullable(),
    opportunityId: uuid.nullable(),
    kind: documentKind,
    origin: documentOrigin,
    title: z.string(),
    /** URL de origem pública. Nunca URL assinada do storage. */
    sourceUrl: z.url().nullable(),
    /** Chave do objeto. Formato: public/<opportunityId>/<sha256>.<ext> | companies/<companyId>/<uuid>.<ext> */
    storageKey: z.string().nullable(),
    mimeType: z.string(),
    sizeBytes: z.number().int().nonnegative().nullable(),
    sha256: sha256.nullable(),
    pageCount: z.number().int().positive().nullable(),
    textStatus,
    textStorageKey: z.string().nullable(),
    uploadedByUserId: uuid.nullable(),
    /** Campos de certidão (kind = company_certificate). */
    certificate: z
      .object({
        category: certificateCategory,
        issuer: z.string(),
        issuedAt: isoDate.nullable(),
        validUntil: isoDate.nullable(),
        defaultValidityDays: z.number().int().positive().nullable(),
        issueUrl: z.url().nullable(),
      })
      .nullable(),
    fetchedAt: isoDateTime.nullable(),
    ...timestamps,
  })
  .refine((d) => d.kind !== 'company_certificate' || (d.companyId !== null && d.certificate !== null), {
    message: 'company_certificate exige companyId e certificate',
  })
  .refine((d) => d.companyId !== null || d.opportunityId !== null, {
    message: 'documento precisa de companyId ou opportunityId',
  });
export type Document = z.infer<typeof document>;
