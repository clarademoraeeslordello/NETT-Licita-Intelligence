/** Formatação compartilhada entre servidor e cliente. */

export const NOT_FOUND_TEXT = 'Não identificado no documento.';

export const STATUS_LABEL: Record<string, string> = {
  found: 'Encontrado no edital',
  inferred: 'Inferido',
  not_found: 'Não identificado',
};

export const STATUS_HINT: Record<string, string> = {
  found: 'Informação localizada explicitamente no edital.',
  inferred:
    'Informação deduzida a partir do contexto do documento — não foi declarada literalmente. Exige conferência.',
  not_found: 'Informação não localizada no documento analisado.',
};

export const NIVEL_LABEL: Record<string, string> = {
  alto: 'Prioridade alta',
  medio: 'Prioridade média',
  baixo: 'Prioridade baixa',
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}

/**
 * Fuso fixo: o relatório é pré-renderizado no servidor e hidratado no browser.
 * Sem fixar o fuso, um servidor em UTC (Vercel, por exemplo) e um usuário em
 * Brasília renderizariam datas diferentes — divergência de hidratação e datas
 * exibidas com um dia de diferença.
 */
const TIME_ZONE = 'America/Sao_Paulo';

export function formatDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
}

export function formatDateTimeLabel(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: TIME_ZONE });
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.round(diff / 1000);
  if (seconds < 5) return 'agora mesmo';
  if (seconds < 60) return `há ${seconds} segundos`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} minuto${minutes > 1 ? 's' : ''}`;
  const hours = Math.round(minutes / 60);
  return `há ${hours} hora${hours > 1 ? 's' : ''}`;
}

/**
 * Interpreta datas no formato DD/MM/AAAA para calcular dias restantes.
 * Datas em outros formatos retornam null (não arriscamos interpretação errada).
 */
export function parseBrDate(value: string): Date | null {
  const match = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(value ?? '');
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const date = new Date(year, month - 1, day, 23, 59, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysUntil(value: string): number | null {
  const date = parseBrDate(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Rótulo relativo de prazo: "em 14 dias", "hoje", "há 3 dias". */
export function prazoRelativo(value: string): { label: string; tone: 'urgent' | 'soon' | 'ok' | 'past' | 'unknown' } {
  const dias = daysUntil(value);
  if (dias === null) return { label: 'data não padronizada', tone: 'unknown' };
  if (dias < 0) return { label: `encerrado há ${Math.abs(dias)} dia${Math.abs(dias) > 1 ? 's' : ''}`, tone: 'past' };
  if (dias === 0) return { label: 'é hoje', tone: 'urgent' };
  if (dias <= 3) return { label: `em ${dias} dia${dias > 1 ? 's' : ''}`, tone: 'urgent' };
  if (dias <= 10) return { label: `em ${dias} dias`, tone: 'soon' };
  return { label: `em ${dias} dias`, tone: 'ok' };
}

export function slugify(value: string, max = 48): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .toLowerCase();
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
