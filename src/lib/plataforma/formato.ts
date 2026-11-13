/** Formatação da plataforma — sempre no fuso de Brasília (ver ui-format.ts). */

const TZ = 'America/Sao_Paulo';
const DIA_MS = 86_400_000;

export function brl(value: number | null | undefined, opcoes: { centavos?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: opcoes.centavos ? 2 : 0,
    maximumFractionDigits: opcoes.centavos ? 2 : 0,
  });
}

/** R$ 1,2 mi · R$ 350 mil · R$ 980 */
export function brlCompacto(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `R$ ${(value / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`;
  if (abs >= 1e6) return `R$ ${(value / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1e4) return `R$ ${Math.round(value / 1e3).toLocaleString('pt-BR')} mil`;
  return brl(value);
}

export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: TZ }).replace('.', '');
}

export function dataLonga(iso: string | null | undefined): string {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

/** Chave YYYY-MM-DD do dia em Brasília (agrupamento da agenda). */
export function chaveDia(iso: string | Date): string {
  const data = typeof iso === 'string' ? new Date(iso) : iso;
  return data.toLocaleDateString('en-CA', { timeZone: TZ });
}

export type Tom = 'critico' | 'atencao' | 'ok' | 'passado' | 'neutro';

/** "em 3 dias", "hoje, 14h", "encerrado" — com o tom visual correspondente. */
export function prazoRelativo(iso: string | null | undefined, agora = Date.now()): { texto: string; tom: Tom; dias: number | null } {
  if (!iso) return { texto: 'sem data', tom: 'neutro', dias: null };
  const alvo = new Date(iso).getTime();
  if (Number.isNaN(alvo)) return { texto: 'sem data', tom: 'neutro', dias: null };
  const dias = (alvo - agora) / DIA_MS;
  if (dias < 0) return { texto: 'encerrado', tom: 'passado', dias };
  if (chaveDia(new Date(alvo)) === chaveDia(new Date(agora))) {
    const hora = new Date(alvo).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
    return { texto: `hoje, ${hora}`, tom: 'critico', dias };
  }
  const inteiros = Math.ceil(dias);
  if (inteiros <= 1) return { texto: 'amanhã', tom: 'critico', dias };
  if (inteiros <= 3) return { texto: `em ${inteiros} dias`, tom: 'critico', dias };
  if (inteiros <= 7) return { texto: `em ${inteiros} dias`, tom: 'atencao', dias };
  return { texto: `em ${inteiros} dias`, tom: 'ok', dias };
}

export const TOM_CLASSES: Record<Tom, string> = {
  critico: 'bg-danger-100 text-danger-700',
  atencao: 'bg-warn-100 text-warn-700',
  ok: 'bg-ok-100 text-ok-700',
  passado: 'bg-ink-100 text-ink-500',
  neutro: 'bg-ink-100 text-ink-600',
};

export function cnpjFormatado(value: string): string {
  const digitos = value.replace(/\D/g, '');
  if (digitos.length !== 14) return value;
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/** Primeira letra maiúscula em cada palavra — nomes de órgãos chegam em CAIXA ALTA. */
export function tituloProprio(value: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o']);
  return value
    .toLowerCase()
    .split(' ')
    .map((palavra, indice) =>
      indice > 0 && minusculas.has(palavra) ? palavra : palavra.charAt(0).toUpperCase() + palavra.slice(1),
    )
    .join(' ');
}

/** Data "YYYY-MM-DD" (sem hora) → "dd/mm/aaaa", sem o deslocamento de fuso do `new Date()`. */
export function dataDia(dia: string | null | undefined): string {
  if (!dia) return '—';
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : dataLonga(dia);
}
