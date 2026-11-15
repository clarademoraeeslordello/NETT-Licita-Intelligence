/**
 * Disjuntor compartilhado dos endpoints /consulta do PNCP. Eles respondem 429 com facilidade e,
 * depois disso, deixam conexões penduradas por minutos. Após uma falha (exceto 404), paramos de
 * chamá-los por um tempo. Estado global do processo (web e worker têm o próprio).
 */
const estado = globalThis as unknown as { __pncpConsultaBloqueadaAte?: number };

export const PAUSA_CONSULTA_MS = 5 * 60_000;

export const consultaBloqueadaAte = (): number => estado.__pncpConsultaBloqueadaAte ?? 0;
export const consultaBloqueada = (agora = Date.now()): boolean => consultaBloqueadaAte() > agora;
export function abrirDisjuntorConsulta(pausaMs = PAUSA_CONSULTA_MS): void {
  estado.__pncpConsultaBloqueadaAte = Date.now() + pausaMs;
}
export function fecharDisjuntorConsulta(): void {
  estado.__pncpConsultaBloqueadaAte = 0;
}
