/**
 * Amostra real do PNCP versionada no projeto (gerada por
 * `scripts/capturar-amostra-pncp.mjs`). Usada quando o portal está fora do ar
 * e para popular o pipeline de exemplo na primeira visita — sempre sinalizada
 * na interface como amostra, nunca apresentada como dado ao vivo.
 */
import amostra from '../fixtures/pncp-amostra.json';
import type { AmostraPreco, Oportunidade } from './types';

type ArquivoAmostra = {
  capturadoEm: string;
  oportunidades: Oportunidade[];
  precos: Record<string, AmostraPreco[]>;
};

const dados = amostra as unknown as ArquivoAmostra;

export const AMOSTRA_CAPTURADA_EM = dados.capturadoEm;
export const amostraOportunidades: Oportunidade[] = dados.oportunidades;
export const amostraPrecos: Record<string, AmostraPreco[]> = dados.precos;
