'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { amostraOportunidades } from '@/lib/pncp/amostra';
import type { Oportunidade } from '@/lib/pncp/types';
import {
  lerWorkspace,
  novoCard,
  renovarDocumento,
  STORAGE_KEY,
  uid,
  workspaceInicial,
  type CardPipeline,
  type Documento,
  type EtapaId,
  type Perfil,
  type Workspace,
} from '@/lib/plataforma/workspace';

type Acoes = {
  salvarPerfil: (perfil: Perfil) => void;
  adicionarAoPipeline: (op: Oportunidade, etapa?: EtapaId) => void;
  removerDoPipeline: (id: string) => void;
  moverCard: (id: string, etapa: EtapaId) => void;
  atualizarCard: (id: string, patch: Partial<Pick<CardPipeline, 'notas' | 'valorProposta' | 'resultado' | 'analiseId'>>) => void;
  limparExemplos: () => void;
  descartar: (id: string) => void;
  restaurarDescartadas: () => void;
  salvarDocumento: (doc: Omit<Documento, 'id'> & { id?: string }) => void;
  removerDocumento: (id: string) => void;
  renovar: (id: string) => void;
  reiniciar: () => void;
  escolherInicio: (modo: 'exemplo' | 'zero') => void;
};

type Contexto = { ws: Workspace; pronto: boolean } & Acoes;

const WorkspaceContext = createContext<Contexto | null>(null);

/**
 * Pipeline de exemplo montado com editais REAIS da amostra do PNCP, marcados
 * como exemplo e removíveis em um clique. Sem isso a primeira visita mostraria
 * um kanban vazio — pouco útil para entender o produto.
 */
function pipelineDeExemplo(agora: number): CardPipeline[] {
  const etapas: EtapaId[] = ['triagem', 'triagem', 'analise', 'documentacao', 'proposta', 'disputa', 'resultado'];
  return amostraOportunidades.slice(0, etapas.length).map((op, indice) => {
    const card = novoCard(op, etapas[indice], agora - (etapas.length - indice) * 3_600_000 * 9);
    card.exemplo = true;
    if (etapas[indice] === 'proposta' || etapas[indice] === 'disputa') {
      card.valorProposta = op.valorEstimado ? Math.round(op.valorEstimado * 0.88) : null;
    }
    if (etapas[indice] === 'resultado') {
      card.resultado = 'ganha';
      card.valorProposta = op.valorEstimado ? Math.round(op.valorEstimado * 0.84) : null;
    }
    return card;
  });
}

function carregar(): Workspace {
  try {
    const salvo = lerWorkspace(window.localStorage.getItem(STORAGE_KEY));
    if (salvo) return salvo;
  } catch {
    /* storage bloqueado (modo privado, política do navegador) */
  }
  const agora = Date.now();
  return workspaceInicial(pipelineDeExemplo(agora), agora);
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // Estado inicial determinístico no servidor; o real entra após a hidratação.
  const [ws, setWs] = useState<Workspace>(() => workspaceInicial([], 0));
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    setWs(carregar());
    setPronto(true);

    // Mantém abas abertas em sincronia.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const novo = lerWorkspace(event.newValue);
      if (novo) setWs(novo);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!pronto) return;
    // Regravar o mesmo valor não dispara o evento `storage` nas outras abas, então não há laço.
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
    } catch {
      /* cota excedida ou storage bloqueado: a sessão continua em memória */
    }
  }, [ws, pronto]);

  const atualizar = useCallback((fn: (atual: Workspace) => Workspace) => setWs((atual) => fn(atual)), []);

  const acoes = useMemo<Acoes>(() => {
    const agoraIso = () => new Date().toISOString();
    return {
      salvarPerfil: (perfil) => atualizar((w) => ({ ...w, perfil })),
      adicionarAoPipeline: (op, etapa = 'triagem') =>
        atualizar((w) => (w.pipeline.some((card) => card.id === op.id) ? w : { ...w, pipeline: [novoCard(op, etapa), ...w.pipeline] })),
      removerDoPipeline: (id) => atualizar((w) => ({ ...w, pipeline: w.pipeline.filter((card) => card.id !== id) })),
      moverCard: (id, etapa) =>
        atualizar((w) => ({
          ...w,
          pipeline: w.pipeline.map((card) => (card.id === id && card.etapa !== etapa ? { ...card, etapa, atualizadoEm: agoraIso() } : card)),
        })),
      atualizarCard: (id, patch) =>
        atualizar((w) => ({
          ...w,
          pipeline: w.pipeline.map((card) => (card.id === id ? { ...card, ...patch, atualizadoEm: agoraIso() } : card)),
        })),
      limparExemplos: () => atualizar((w) => ({ ...w, pipeline: w.pipeline.filter((card) => !card.exemplo) })),
      descartar: (id) => atualizar((w) => (w.descartadas.includes(id) ? w : { ...w, descartadas: [...w.descartadas, id] })),
      restaurarDescartadas: () => atualizar((w) => ({ ...w, descartadas: [] })),
      salvarDocumento: (doc) =>
        atualizar((w) => {
          if (doc.id && w.documentos.some((item) => item.id === doc.id)) {
            return { ...w, documentos: w.documentos.map((item) => (item.id === doc.id ? ({ ...item, ...doc } as Documento) : item)) };
          }
          return { ...w, documentos: [...w.documentos, { ...doc, id: doc.id ?? uid('doc') } as Documento] };
        }),
      removerDocumento: (id) => atualizar((w) => ({ ...w, documentos: w.documentos.filter((doc) => doc.id !== id) })),
      renovar: (id) => atualizar((w) => ({ ...w, documentos: w.documentos.map((doc) => (doc.id === id ? renovarDocumento(doc) : doc)) })),
      // "Começar do zero": sem pipeline nem documentos de exemplo; o perfil fica para a pessoa ajustar.
      escolherInicio: (modo) =>
        atualizar((w) => (modo === 'exemplo' ? { ...w, inicio: 'exemplo' } : { ...w, inicio: 'zero', pipeline: [], documentos: [], descartadas: [] })),
      reiniciar: () => {
        const agora = Date.now();
        setWs(workspaceInicial(pipelineDeExemplo(agora), agora));
      },
    };
  }, [atualizar]);

  const valor = useMemo<Contexto>(() => ({ ws, pronto, ...acoes }), [ws, pronto, acoes]);
  return <WorkspaceContext.Provider value={valor}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Contexto {
  const contexto = useContext(WorkspaceContext);
  if (!contexto) throw new Error('useWorkspace precisa estar dentro de <WorkspaceProvider>.');
  return contexto;
}
