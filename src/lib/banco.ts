/**
 * Acesso ao Supabase do lado do servidor, só por funções `public.arremate_*`
 * que exigem o segredo do servidor (as tabelas ficam no schema `arremate`,
 * fora da API REST). Sem variáveis configuradas, quem chama cai para memória.
 */
export const bancoConfigurado = (): boolean =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.ARREMATE_SEGREDO);

export async function rpc<T>(funcao: string, parametros: Record<string, unknown>, timeoutMs = 8_000): Promise<T> {
  const url = `${process.env.SUPABASE_URL!.replace(/\/+$/, '')}/rest/v1/rpc/${funcao}`;
  const resposta = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_segredo: process.env.ARREMATE_SEGREDO, ...parametros }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  const texto = await resposta.text();
  if (!resposta.ok) throw new Error(`${funcao}: HTTP ${resposta.status} ${texto.slice(0, 200)}`);
  return (texto ? JSON.parse(texto) : null) as T;
}
