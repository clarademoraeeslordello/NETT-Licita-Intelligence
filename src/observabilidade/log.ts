/**
 * Log estruturado em JSON (uma linha por evento) com remoção de segredos.
 * Nunca registrar token/key do Trello, cabeçalhos de autorização ou payloads completos.
 */
type Nivel = 'debug' | 'info' | 'warn' | 'error';

const SEGREDOS = /([?&](?:key|token)=)[^&\s"]+/gi;

export function ocultarSegredos(texto: string): string {
  return texto.replace(SEGREDOS, '$1***');
}

function serializar(valor: unknown): unknown {
  if (valor instanceof Error) return { nome: valor.name, mensagem: ocultarSegredos(valor.message) };
  if (typeof valor === 'string') return ocultarSegredos(valor);
  return valor;
}

export function log(nivel: Nivel, evento: string, campos: Record<string, unknown> = {}): void {
  if (nivel === 'debug' && process.env.LOG_DEBUG !== 'true') return;
  const registro: Record<string, unknown> = { ts: new Date().toISOString(), nivel, evento };
  for (const [chave, valor] of Object.entries(campos)) registro[chave] = serializar(valor);
  const linha = JSON.stringify(registro);
  if (nivel === 'error' || nivel === 'warn') process.stderr.write(`${linha}\n`);
  else process.stdout.write(`${linha}\n`);
}
