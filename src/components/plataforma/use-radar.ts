'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { calcularAderencia, type Aderencia } from '@/lib/plataforma/aderencia';
import type { OportunidadeRadar, RadarResposta } from '@/lib/pncp/radar';
import { useWorkspace } from './workspace-provider';

export type ItemRadar = OportunidadeRadar & {
  aderencia: Aderencia;
  valorStatus: 'ok' | 'carregando' | 'indisponivel';
};

type EstadoRadar =
  | { fase: 'carregando' }
  | { fase: 'pronto'; resposta: RadarResposta; buscadoEm: number }
  | { fase: 'erro'; mensagem: string; dica?: string };

/*
 * Cache do lado do cliente, no escopo do módulo: navegar Painel → Radar →
 * Painel não refaz a busca. Os valores estimados ficam num mapa separado
 * porque chegam depois, em lotes.
 */
const respostas = new Map<string, { resposta: RadarResposta; buscadoEm: number }>();
const valores = new Map<string, number | null>();
const valoresFalhos = new Set<string>();
const VALIDADE_CACHE_MS = 10 * 60_000;
const LOTE_VALORES = 6;
const MAX_VALORES = 42;

export function chaveRadar(termos: string[], ufs: string[], modalidades: number[]): string {
  const params = new URLSearchParams();
  params.set('termos', termos.join(','));
  if (ufs.length) params.set('ufs', [...ufs].sort().join(','));
  if (modalidades.length) params.set('modalidades', [...modalidades].sort((a, b) => a - b).join(','));
  return params.toString();
}

export function useRadar() {
  const { ws, pronto } = useWorkspace();
  const { perfil } = ws;
  const chave = chaveRadar(perfil.termos, perfil.ufs, perfil.modalidades);

  const [estado, setEstado] = useState<EstadoRadar>({ fase: 'carregando' });
  const [versaoValores, setVersaoValores] = useState(0);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!pronto) return;
    if (perfil.termos.length === 0) {
      setEstado({ fase: 'erro', mensagem: 'O perfil não tem termos de busca.', dica: 'Cadastre em Perfil os produtos ou serviços que a empresa fornece.' });
      return;
    }

    const emCache = respostas.get(chave);
    if (emCache && Date.now() - emCache.buscadoEm < VALIDADE_CACHE_MS && recarga === 0) {
      setEstado({ fase: 'pronto', ...emCache });
      return;
    }

    const controle = new AbortController();
    setEstado({ fase: 'carregando' });
    fetch(`/api/radar?${chave}`, { signal: controle.signal })
      .then(async (res) => {
        const corpo = (await res.json()) as RadarResposta & { error?: { message: string; hint?: string } };
        if (!res.ok || corpo.error) {
          setEstado({ fase: 'erro', mensagem: corpo.error?.message ?? 'Não foi possível consultar o PNCP.', dica: corpo.error?.hint });
          return;
        }
        const entrada = { resposta: corpo, buscadoEm: Date.now() };
        respostas.set(chave, entrada);
        setEstado({ fase: 'pronto', ...entrada });
      })
      .catch((erro: Error) => {
        if (erro.name === 'AbortError') return;
        setEstado({ fase: 'erro', mensagem: 'Falha de comunicação com o servidor.', dica: 'Verifique a conexão e tente novamente.' });
      });
    return () => controle.abort();
  }, [chave, pronto, perfil.termos.length, recarga]);

  const itens = useMemo<ItemRadar[]>(() => {
    if (estado.fase !== 'pronto') return [];
    const agora = Date.now();
    const aoVivo = estado.resposta.fonte === 'pncp';
    return estado.resposta.oportunidades
      .map((op) => {
        const comValor = { ...op, valorEstimado: op.valorEstimado ?? valores.get(op.id) ?? null };
        return { ...comValor, aderencia: calcularAderencia(comValor, perfil, agora) };
      })
      .sort((a, b) => b.aderencia.nota - a.aderencia.nota)
      .map((item, posicao) => {
        // Só as MAX_VALORES primeiras têm o valor consultado; as demais mostram "—".
        const aguardando = aoVivo && !valores.has(item.id) && !valoresFalhos.has(item.id) && posicao < MAX_VALORES;
        const valorStatus: ItemRadar['valorStatus'] = item.valorEstimado !== null ? 'ok' : aguardando ? 'carregando' : 'indisponivel';
        return { ...item, valorStatus };
      });
    // versaoValores força o recálculo quando um lote de valores chega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, perfil, versaoValores]);

  // Valores estimados em lotes, dos mais aderentes para os menos.
  useEffect(() => {
    if (estado.fase !== 'pronto' || estado.resposta.fonte !== 'pncp') return;
    let cancelado = false;
    const pendentes = itens.filter((item) => item.valorStatus === 'carregando').map((item) => item.id);
    if (pendentes.length === 0) return;

    (async () => {
      for (let indice = 0; indice < pendentes.length && !cancelado; indice += LOTE_VALORES) {
        const lote = pendentes.slice(indice, indice + LOTE_VALORES);
        try {
          const res = await fetch(`/api/pncp/valores?ids=${lote.join(',')}`);
          const corpo = (await res.json()) as { valores: Record<string, number | null>; falhas: string[] };
          for (const [id, valor] of Object.entries(corpo.valores ?? {})) valores.set(id, valor);
          for (const id of corpo.falhas ?? []) valoresFalhos.add(id);
        } catch {
          lote.forEach((id) => valoresFalhos.add(id));
        }
        if (!cancelado) setVersaoValores((versao) => versao + 1);
      }
    })();

    return () => {
      cancelado = true;
    };
    // Só dispara quando uma nova resposta do radar chega, não a cada lote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const recarregar = useCallback(() => {
    respostas.delete(chave);
    setRecarga((valor) => valor + 1);
  }, [chave]);

  return {
    estado,
    itens,
    recarregar,
    carregandoValores: itens.some((item) => item.valorStatus === 'carregando'),
  };
}
