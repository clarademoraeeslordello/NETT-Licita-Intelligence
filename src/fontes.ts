/** Registro dos conectores disponíveis. Nova fonte = novo conector + entrada aqui. */
import type { Config } from './config/index.js';
import { ConectorComprasGov } from './conectores/comprasgov/conector.js';
import { ConectorPncp } from './conectores/pncp/conector.js';
import { ConectorSigaRj } from './conectores/siga-rj/conector.js';
import type { ConectorLicitacoes } from './conectores/tipos.js';

export function criarConectores(config: Config): { conectores: Map<string, ConectorLicitacoes>; pncp: ConectorPncp } {
  const pncp = new ConectorPncp(config.PNCP_MODALIDADES);
  const conectores = new Map<string, ConectorLicitacoes>([
    ['pncp', pncp],
    ['comprasgov', new ConectorComprasGov(config.COMPRASGOV_MODALIDADES)],
    ['siga_rj', new ConectorSigaRj(config.SIGA_RJ_HABILITADO)],
  ]);
  return { conectores, pncp };
}
