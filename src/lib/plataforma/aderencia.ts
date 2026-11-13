/**
 * Nota de aderência (0–100) entre uma oportunidade e o perfil da empresa.
 *
 * A nota é auditável de propósito: cada ponto vem de um fator nomeado, e a
 * interface mostra a decomposição. Quem decide participar precisa saber POR QUE
 * um edital subiu no ranking — não confiar numa caixa-preta.
 */
import type { Oportunidade } from '../pncp/types';
import { contemTermo, normalizar } from './texto';

export type PerfilAderencia = {
  termos: string[];
  termosExcluir: string[];
  ufs: string[];
  modalidades: number[];
  valorMin: number | null;
  valorMax: number | null;
};

export type FatorAderencia = {
  id: 'objeto' | 'regiao' | 'valor' | 'prazo' | 'modalidade';
  label: string;
  pontos: number;
  max: number;
  detalhe: string;
};

export type Aderencia = {
  nota: number;
  faixa: 'alta' | 'media' | 'baixa';
  fatores: FatorAderencia[];
  termosEncontrados: string[];
  bloqueio: string | null;
};

const DIA_MS = 86_400_000;

export function diasAte(iso: string | null, agora = Date.now()): number | null {
  if (!iso) return null;
  const alvo = new Date(iso).getTime();
  if (Number.isNaN(alvo)) return null;
  return (alvo - agora) / DIA_MS;
}

const brl = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function calcularAderencia(op: Oportunidade, perfil: PerfilAderencia, agora = Date.now()): Aderencia {
  const texto = normalizar(`${op.objeto} ${op.titulo}`);
  const termosEncontrados = perfil.termos.filter((termo) => contemTermo(texto, termo));
  const excluido = perfil.termosExcluir.find((termo) => contemTermo(texto, termo)) ?? null;

  // Objeto — até 45 pontos: o 1º termo vale 30, cada termo extra soma 7,5.
  const objetoPontos = termosEncontrados.length === 0 ? 0 : Math.min(45, 30 + (termosEncontrados.length - 1) * 7.5);
  const objeto: FatorAderencia = {
    id: 'objeto',
    label: 'Objeto',
    pontos: objetoPontos,
    max: 45,
    detalhe:
      termosEncontrados.length === 0
        ? 'Nenhum termo do perfil aparece no objeto'
        : `${termosEncontrados.length} termo(s) do perfil no objeto`,
  };

  // Região — até 15.
  const semPreferenciaUf = perfil.ufs.length === 0;
  const ufAtendida = perfil.ufs.includes(op.uf);
  const regiao: FatorAderencia = {
    id: 'regiao',
    label: 'Região',
    pontos: semPreferenciaUf ? 10 : ufAtendida ? 15 : 0,
    max: 15,
    detalhe: semPreferenciaUf ? 'Perfil atende todo o país' : ufAtendida ? `${op.uf} está na área de atuação` : `${op.uf || 'UF'} fora da área de atuação`,
  };

  // Valor — até 15. Sem valor publicado fica neutro (não pune nem premia).
  let valorPontos = 7;
  let valorDetalhe = 'Valor estimado não informado';
  if (op.valorEstimado !== null) {
    const abaixo = perfil.valorMin !== null && op.valorEstimado < perfil.valorMin;
    const acima = perfil.valorMax !== null && op.valorEstimado > perfil.valorMax;
    if (abaixo) {
      valorPontos = 5;
      valorDetalhe = `${brl(op.valorEstimado)} abaixo do ticket mínimo`;
    } else if (acima) {
      valorPontos = 3;
      valorDetalhe = `${brl(op.valorEstimado)} acima da capacidade declarada`;
    } else {
      valorPontos = 15;
      valorDetalhe = `${brl(op.valorEstimado)} dentro da faixa do perfil`;
    }
  }
  const valor: FatorAderencia = { id: 'valor', label: 'Valor', pontos: valorPontos, max: 15, detalhe: valorDetalhe };

  // Prazo — até 15: tempo útil para montar documentação e proposta.
  const dias = diasAte(op.encerramentoPropostas, agora);
  let prazoPontos = 8;
  let prazoDetalhe = 'Data de encerramento não informada';
  if (dias !== null) {
    if (dias < 0) {
      prazoPontos = 0;
      prazoDetalhe = 'Recebimento de propostas encerrado';
    } else if (dias < 1) {
      prazoPontos = 2;
      prazoDetalhe = 'Encerra em menos de 24 horas';
    } else if (dias < 3) {
      prazoPontos = 6;
      prazoDetalhe = `Encerra em ${Math.floor(dias)} dia(s) — prazo apertado`;
    } else if (dias < 7) {
      prazoPontos = 11;
      prazoDetalhe = `Encerra em ${Math.floor(dias)} dias`;
    } else {
      prazoPontos = 15;
      prazoDetalhe = `${Math.floor(dias)} dias para preparar a proposta`;
    }
  }
  const prazo: FatorAderencia = { id: 'prazo', label: 'Prazo', pontos: prazoPontos, max: 15, detalhe: prazoDetalhe };

  // Modalidade — até 10.
  const semPreferenciaModalidade = perfil.modalidades.length === 0;
  const modalidadeOk = perfil.modalidades.includes(op.modalidadeId);
  const modalidade: FatorAderencia = {
    id: 'modalidade',
    label: 'Modalidade',
    pontos: semPreferenciaModalidade || modalidadeOk ? 10 : 4,
    max: 10,
    detalhe: semPreferenciaModalidade || modalidadeOk ? `${op.modalidade} é preferida` : `${op.modalidade} fora das preferidas`,
  };

  const fatores = [objeto, regiao, valor, prazo, modalidade];
  let nota = Math.round(fatores.reduce((total, fator) => total + fator.pontos, 0));

  let bloqueio: string | null = null;
  if (excluido) {
    bloqueio = `Contém o termo excluído “${excluido}”`;
    nota = Math.min(nota, 10);
  } else if (op.cancelado) {
    bloqueio = 'Contratação cancelada';
    nota = Math.min(nota, 5);
  } else if (termosEncontrados.length === 0) {
    // Sem aderência de objeto, os demais fatores não podem, sozinhos, recomendar o edital.
    nota = Math.min(nota, 35);
  }

  return {
    nota,
    faixa: nota >= 70 ? 'alta' : nota >= 45 ? 'media' : 'baixa',
    fatores,
    termosEncontrados,
    bloqueio,
  };
}
