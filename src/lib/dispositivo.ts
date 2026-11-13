/**
 * Identificador aleatório deste navegador, usado só na cota de análises com IA
 * (junto com o IP). Não identifica a pessoa: é um UUID guardado no localStorage.
 */
const CHAVE = 'arremate:dispositivo';

export function cabecalhoDispositivo(): Record<string, string> {
  try {
    let id = localStorage.getItem(CHAVE);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CHAVE, id);
    }
    return { 'x-arremate-dispositivo': id };
  } catch {
    return {};
  }
}
