/**
 * Contadores em memória do processo, expostos em /metricas (formato Prometheus).
 * Métricas duráveis de execução ficam em integracao.execucao_coleta.
 */
const contadores = new Map<string, number>();

const chave = (nome: string, rotulos: Record<string, string | number> = {}) => {
  const partes = Object.entries(rotulos)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`);
  return partes.length ? `${nome}{${partes.join(',')}}` : nome;
};

export function incrementar(nome: string, rotulos: Record<string, string | number> = {}, valor = 1): void {
  const k = chave(nome, rotulos);
  contadores.set(k, (contadores.get(k) ?? 0) + valor);
}

export function valorMetrica(nome: string, rotulos: Record<string, string | number> = {}): number {
  return contadores.get(chave(nome, rotulos)) ?? 0;
}

export function exportarProcesso(): string {
  return [...contadores.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `nett_${k} ${v}`)
    .join('\n');
}
