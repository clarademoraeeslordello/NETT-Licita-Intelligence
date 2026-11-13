/**
 * Entidades de suporte: empresa cliente (tenant), usuário e vínculo.
 * Premissa P-03: consultores Nett atendem várias empresas clientes.
 * Dono: agente 01.
 */
import { z } from 'zod';
import { cnpj, timestamps, uuid } from './common';

export const companySize = z.enum(['ME', 'EPP', 'DEMAIS']);

export const company = z.object({
  id: uuid,
  legalName: z.string().min(1),
  tradeName: z.string().nullable(),
  cnpj,
  size: companySize,
  status: z.enum(['active', 'suspended', 'archived']),
  ...timestamps,
});
export type Company = z.infer<typeof company>;

/** Papéis globais vindos do Keycloak (realm roles). */
export const realmRole = z.enum(['nett_admin', 'nett_consultant']);
/** Papéis por empresa, guardados no banco (Membership). */
export const companyRole = z.enum(['company_admin', 'consultant', 'viewer']);

export const userAccount = z.object({
  id: uuid,
  /** `sub` do token Keycloak. Único. */
  keycloakSub: z.string().min(1),
  email: z.email(),
  name: z.string(),
  active: z.boolean(),
  ...timestamps,
});
export type UserAccount = z.infer<typeof userAccount>;

export const membership = z.object({
  userId: uuid,
  companyId: uuid,
  role: companyRole,
  ...timestamps,
});
export type Membership = z.infer<typeof membership>;
