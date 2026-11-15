/**
 * Handlers do agente 02 registrados no worker. Os de outros agentes (03, 04) entram aqui via PR
 * deles, importando de seus módulos. Filas sem handler simplesmente acumulam até o dono registrar.
 *
 * T-105 entrega o runner; os handlers de `source.sync`/`source.normalize` chegam em T-202
 * e `document.fetch` em T-203.
 */
import { JobRegistry } from './registry';

export function buildRegistry(): JobRegistry {
  return new JobRegistry();
}
