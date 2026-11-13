import { cache } from 'react';
import { collectCapabilities, degradedCapabilities } from './capabilities.server';
import type { Capabilities } from './api-types';

/**
 * Capacidades do ambiente para os server components.
 *
 * `cache` do React garante uma única coleta por requisição (layout + página +
 * componentes compartilham o resultado) e a coleta é feita em processo — sem
 * auto-fetch HTTP, sem dependência de cabeçalhos do cliente.
 *
 * Em caso de falha, devolvemos `degraded: true` para que a interface NÃO anuncie
 * "IA não configurada" quando o problema foi apenas a própria verificação.
 */
export const getCapabilities = cache(async (): Promise<Capabilities & { degraded?: boolean }> => {
  try {
    return await collectCapabilities();
  } catch {
    return degradedCapabilities();
  }
});

export type { Capabilities };
