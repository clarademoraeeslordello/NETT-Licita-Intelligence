'use client';

/** Cliente fino de /api/v1 para as telas. O cookie de sessão vai junto; a origem é a mesma (withApi confere). */
import { useCallback, useEffect, useState } from 'react';

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ErroApi';
  }
}

export async function chamarApi<T>(caminho: string, init: { method?: 'GET' | 'POST' | 'PATCH'; corpo?: unknown } = {}): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/v1${caminho}`, {
      method: init.method ?? 'GET',
      headers: init.corpo !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ErroApi(0, 'REDE', 'Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }
  if (resposta.status === 401) {
    window.location.assign(`/api/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
    throw new ErroApi(401, 'UNAUTHENTICATED', 'Sessão expirada.');
  }
  const json = (await resposta.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!resposta.ok) throw new ErroApi(resposta.status, json?.error?.code ?? 'ERRO', json?.error?.message ?? 'Não foi possível concluir a operação.', json?.error?.details);
  return json as T;
}

export const mensagemDeErro = (e: unknown) => (e instanceof ErroApi ? e.message : 'Erro inesperado. Tente de novo.');

/** Carrega ao montar e quando `chave` muda (ex.: troca de empresa). */
export function useCarga<T>(carregar: () => Promise<T>, chave: string) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await carregar());
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { dados, setDados, erro, carregando, recarregar };
}
