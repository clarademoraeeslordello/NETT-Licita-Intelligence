/**
 * Re-exporta o schema canônico de `fit_assessment`, que passou a viver em src/contracts/fit.ts (contratos 1.2.0).
 * Mantido para não quebrar importações existentes; novos usos devem importar de '@/contracts'.
 */
export * from '../../../contracts/fit';
