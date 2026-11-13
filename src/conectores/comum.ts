import type { Esfera } from '../contrato/normalizada.js';

export const limpar = (valor: string | null | undefined): string | null => {
  const texto = (valor ?? '').replace(/\s+/g, ' ').trim();
  return texto || null;
};

/** Datas das APIs governamentais chegam sem fuso e em horário de Brasília. (Portado de licitaflow.) */
export function isoBrasilia(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const base = valor.replace(/\.\d+$/, '');
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(base)) {
    const d = new Date(base);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const comSegundos = /T\d{2}:\d{2}$/.test(base) ? `${base}:00` : /^\d{4}-\d{2}-\d{2}$/.test(base) ? `${base}T00:00:00` : base;
  const data = new Date(`${comSegundos}-03:00`);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

export const ESFERAS: Record<string, Esfera> = { F: 'federal', E: 'estadual', M: 'municipal', D: 'distrital' };

/** Códigos de modalidade de contratação do PNCP (Lei 14.133/2021). (Portado de licitaflow.) */
export const MODALIDADES_PNCP: Record<number, string> = {
  1: 'Leilão eletrônico',
  2: 'Diálogo competitivo',
  3: 'Concurso',
  4: 'Concorrência eletrônica',
  5: 'Concorrência presencial',
  6: 'Pregão eletrônico',
  7: 'Pregão presencial',
  8: 'Dispensa',
  9: 'Inexigibilidade',
  10: 'Manifestação de interesse',
  11: 'Pré-qualificação',
  12: 'Credenciamento',
  13: 'Leilão presencial',
};

export const linkPncp = (cnpj: string, ano: string | number, sequencial: string | number) =>
  `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${Number(sequencial)}`;

/** `{cnpj}-1-{seq6}/{ano}` → partes. */
export function partesControlePncp(controle: string): { cnpj: string; ano: string; sequencial: string } | null {
  const m = /^(\d{14})-\d+-(\d{1,7})\/(\d{4})$/.exec(controle.trim());
  if (!m) return null;
  return { cnpj: m[1]!, sequencial: String(Number(m[2])), ano: m[3]! };
}

export const numeroOuNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const canceladaPorSituacao = (situacao: string | null) => /cancelad|revogad|anulad/i.test(situacao ?? '');
