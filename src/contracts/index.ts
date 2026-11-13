/**
 * Ponto único de importação dos contratos canônicos.
 * Regra: módulos importam tipos/schemas DAQUI. Redefinir uma entidade canônica em outro lugar é motivo de rejeição de PR.
 */
export * from './common';
export * from './tenancy';
export * from './sources';
export * from './documents';
export * from './analysis';
export * from './company';
export * from './metrics';
export * from './jobs';
