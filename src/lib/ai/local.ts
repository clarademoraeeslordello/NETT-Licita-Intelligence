/**
 * Motor de análise local (determinístico, sem chamada a LLM).
 *
 * Usado como demonstração offline: permite que o produto seja apresentado
 * mesmo sem chave de API configurada. Não é IA — é extração por padrões
 * léxicos — e por isso a interface SEMPRE rotula o resultado como análise
 * local de demonstração, nunca como análise de IA.
 */
import type { ExtractedDocument } from '../pdf/extract';
import type {
  AnaliseEditais,
  AttentionPoint,
  ChecklistEntry,
  Evidence,
  SourcedItem,
  TimelineEntry,
  TenderItem,
} from '../schema';

type PageHit = { page: number; text: string };

const MODALIDADES: Array<[string, RegExp]> = [
  ['Pregão Eletrônico', /preg[ãa]o\s+eletr[ôo]nico/i],
  ['Pregão Presencial', /preg[ãa]o\s+presencial/i],
  ['Concorrência', /concorr[êe]ncia/i],
  ['Concurso', /concurso\s+de\s+projetos|concurso\s+p[úu]blico/i],
  ['Leilão', /leil[ãa]o/i],
  ['Diálogo Competitivo', /di[áa]logo\s+competitivo/i],
  ['Dispensa Eletrônica', /dispensa\s+eletr[ôo]nica/i],
  ['Dispensa de Licitação', /dispensa\s+de\s+licita[çc][ãa]o/i],
  ['Inexigibilidade', /inexigibilidade/i],
  ['Tomada de Preços', /tomada\s+de\s+pre[çc]os/i],
  ['Convite', /carta\s+convite|\bconvite\b/i],
  ['Credenciamento', /credenciamento/i],
  ['Manifestação de Interesse', /manifesta[çc][ãa]o\s+de\s+interesse|PMI/i],
];

const DATE_RE =
  /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b(?:[^\d]{0,25}?(?:[àa]s\s*)?(\d{1,2})\s*[h:]\s*(\d{2})?)?/gi;

const CURRENCY_RE = /R\$\s*([\d.]{1,20},\d{2}|\d{1,20}(?:\.\d{3})*)/gi;

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/**
 * Classificação de eventos de cronograma.
 * Cada regra traz uma prioridade: quanto maior, mais específico é o marco —
 * o desempate entre datas iguais usa essa prioridade.
 */
const EVENT_RULES: Array<{ nome: string; regex: RegExp; prioridade: number }> = [
  {
    nome: 'Encerramento do recebimento das propostas',
    regex: /encerramento[^\n]{0,60}(propostas|documenta)|prazo\s+(?:final|limite)[^\n]{0,40}propostas|limite\s+para\s+(?:entrega|envio|apresenta[çc][ãa]o)[^\n]{0,30}propostas|data\s+final[^\n]{0,40}propostas|recebimento\s+das\s+propostas\s+ser[áa]\s+encerrado|encerrado[^\n]{0,60}(?:às|as)\s*\d{1,2}\s*(?:h|:)/i,
    prioridade: 10,
  },
  {
    nome: 'Início do recebimento das propostas',
    regex: /in[íi]cio\s+(?:do\s+)?(?:prazo\s+)?(?:de\s+)?(?:recebimento|acolhimento)|abertura\s+do\s+prazo|a\s+partir\s+de[^\n]{0,30}(?:propostas)/i,
    prioridade: 6,
  },
  {
    nome: 'Abertura das propostas',
    regex: /abertura\s+(?:das\s+)?(?:propostas|sess[ãa]o)|sess[ãa]o\s+p[úu]blica\s+de\s+abertura|in[íi]cio\s+da\s+sess[ãa]o/i,
    prioridade: 9,
  },
  {
    nome: 'Sessão pública de disputa',
    regex: /sess[ãa]o\s+p[úu]blica|disputa\s+de\s+lances|fase\s+de\s+disputa/i,
    prioridade: 5,
  },
  {
    nome: 'Publicação do edital',
    regex: /publica[çc][ãa]o[^\n]{0,30}(aviso|edital)|aviso\s+de\s+licita[çc][ãa]o|divulga[çc][ãa]o\s+do\s+aviso/i,
    prioridade: 3,
  },
  { nome: 'Prazo de impugnação', regex: /impugna[çc][ãa]o|impugnar/i, prioridade: 8 },
  {
    nome: 'Prazo de esclarecimentos',
    regex: /esclarecimento|pedido\s+de\s+informa[çc][ãa]o|d[úu]vidas?\s+sobre\s+o\s+edital/i,
    prioridade: 8,
  },
  { nome: 'Prazo de recursos', regex: /\brecurso/i, prioridade: 7 },
  {
    nome: 'Garantia de execução contratual',
    regex: /garantia\s+de\s+execu[çc][ãa]o|apresenta[çc][ãa]o\s+da\s+garantia/i,
    prioridade: 4,
  },
  {
    nome: 'Assinatura do contrato',
    regex: /assinatura\s+do\s+contrato|convoca[çc][ãa]o\s+do\s+adjudicat[áa]rio/i,
    prioridade: 4,
  },
  {
    nome: 'Vigência do contrato',
    regex: /vig[êe]ncia\s+(?:do\s+)?contrato|prazo\s+de\s+vig[êe]ncia|vig[êe]ncia\s+de\s+\d/i,
    prioridade: 4,
  },
  {
    nome: 'Prazo de entrega',
    regex: /prazo\s+de\s+entrega|entrega\s+(?:dos|de)\s+(bens|produtos|materiais|equipamentos)|entrega\s+em\s+at[ée]\s+\d/i,
    prioridade: 5,
  },
  {
    nome: 'Prazo de execução',
    regex: /prazo\s+de\s+execu[çc][ãa]o|execu[çc][ãa]o\s+(?:dos|de)\s+servi[çc]os|instala[çc][ãa]o[^\n]{0,30}at[ée]/i,
    prioridade: 5,
  },
  { nome: 'Visita técnica', regex: /visita\s+t[ée]cnica|vistoria/i, prioridade: 4 },
  { nome: 'Apresentação de amostra', regex: /apresenta[çc][ãa]o\s+de\s+amostra|prova\s+de\s+conceito/i, prioridade: 3 },
  { nome: 'Validade da proposta', regex: /validade\s+das?\s+propostas?/i, prioridade: 3 },
];

/**
 * Constrói um rótulo de evento a partir do texto da própria linha.
 * Rejeita fragmentos de frase (ex.: "(Compras.gov.br), com início no dia") para
 * não produzir um marco com nome sem sentido.
 */
function labelFromLine(line: string, dateIndex: number): string | null {
  const raw = clean(line.slice(0, dateIndex))
    // Remove numeração de cláusula ("3.6.", "1.4.2") antes de avaliar o rótulo.
    .replace(/^\s*\d{1,3}(?:\.\d{1,3})*\s*[.)\-–]?\s*/, '')
    .replace(/[.,;:–-]+$/, '');
  if (!raw) return null;

  // Rótulo precisa ser um trecho local: se houver frase anterior ou um
  // conector explicativo entre o rótulo e a data, o texto antes da data não
  // descreve o marco — devolvemos null para forçar a classificação por
  // palavra-chave em vez de aceitar um rótulo truncado.
  if (/[.;:!?]\s/.test(raw)) return null;
  if (/\bou seja\b|\bisto [ée]\b|\bpor meio\b|\bconforme\b|\bobservado\b/i.test(raw)) return null;
  if (raw.length > 70) return null;

  const label = raw.replace(/^(?:data|dia|prazo)\s+(?:de|da|do|para)?\s*/i, '').trim();
  if (label.length < 6 || label.length > 70) return null;
  if (/[()]/.test(label)) return null;
  if (label.startsWith('"') || label.startsWith('“') || label.startsWith('”')) return null;
  if (/^(?:e|ou|com|sem|para|do|da|de|no|na|em|aos|às|ao|os|as|das|dos|pelo|pela|que|ser[áa]|foi|é)\b/i.test(label)) {
    return null;
  }
  if (/(?:,|\bde|\bdo|\bda|\bcom|\bpara|\bem|\bao|\bà|\be|\bou|\bdia|\bno|\bna|\bpor)$/i.test(label)) return null;
  if (!/^\p{Lu}/u.test(label)) return null;

  return label;
}

/**
 * Escolhe o evento mais provável.
 * Quando a linha contém um rótulo explícito (ex.: "Abertura das propostas"),
 * ele vence a classificação genérica por palavra-chave — inclusive quando o
 * mesmo trecho menciona outros marcos como referência de prazo.
 */
function classifyEvent(
  line: string,
  label: string | null,
  dateIndex: number,
): { evento: string; prioridade: number } {
  const antes = dateIndex > 0 ? line.slice(0, dateIndex) : line;

  if (label) {
    for (const rule of EVENT_RULES) {
      if (rule.regex.test(label)) return { evento: rule.nome, prioridade: rule.prioridade + 2 };
    }
    // Rótulo explícito que não é um marco conhecido: usa o próprio texto.
    return { evento: label, prioridade: 1 };
  }

  for (const rule of EVENT_RULES) {
    if (rule.regex.test(antes)) return { evento: rule.nome, prioridade: rule.prioridade };
  }
  for (const rule of EVENT_RULES) {
    if (rule.regex.test(line)) return { evento: rule.nome, prioridade: rule.prioridade };
  }
  return { evento: 'Data relevante', prioridade: 0 };
}

const REQUIREMENT_BUCKETS: Array<{
  key: keyof Buckets;
  label: string;
  patterns: RegExp[];
}> = [
  {
    key: 'habilitacaoJuridica',
    label: 'Habilitação jurídica',
    patterns: [/habilita[çc][ãa]o\s+jur[íi]dica/i, /contrato\s+social|estatuto\s+social|ato\s+constitutivo/i, /procura[çc][ãa]o|representante\s+legal/i],
  },
  {
    key: 'habilitacaoFiscalTrabalhista',
    label: 'Habilitação fiscal e trabalhista',
    patterns: [/habilita[çc][ãa]o\s+fiscal/i, /regularidade\s+fiscal/i, /trabalhista/i, /FGTS|INSS|CND/i],
  },
  {
    key: 'qualificacaoTecnica',
    label: 'Qualificação técnica',
    patterns: [/qualifica[çc][ãa]o\s+t[ée]cnica/i, /atestado\s+de\s+capacidade/i, /acervo\s+t[ée]cnico/i, /registro\s+no\s+conselho|\bCREA\b|\bCAU\b|\bCRM\b|\bCRC\b/i],
  },
  {
    key: 'qualificacaoEconomicoFinanceira',
    label: 'Qualificação econômico-financeira',
    patterns: [/qualifica[çc][ãa]o\s+econ[ôo]mico/i, /balan[çc]o\s+patrimonial/i, /certid[ãa]o\s+negativa\s+de\s+fal[êe]ncia/i, /capital\s+social|patrim[ôo]nio\s+l[íi]quido|[íi]ndices?\s+contab/i],
  },
  {
    key: 'certidoes',
    label: 'Certidões',
    patterns: [/certid[ãa]o/i, /\bCND\b|\bCRF\b/i],
  },
  {
    key: 'documentos',
    label: 'Documentos de habilitação',
    patterns: [/documenta[çc][ãa]o\s+de\s+habilita[çc][ãa]o|documentos?\s+de\s+habilita[çc][ãa]o|envelopes?/i, /declara[çc][ãa]o/i, /planilha\s+de\s+composi[çc][ãa]o/i],
  },
  {
    key: 'restricoes',
    label: 'Restrições e impedimentos',
    patterns: [/n[ãa]o\s+poder[ãa]o\s+participar|impedid|vedada\s+a\s+participa[çc][ãa]o|suspens[ãa]o|inidoneidade/i, /fal[êe]ncia|recupera[çc][ãa]o\s+judicial/i],
  },
  {
    key: 'visitasOuAmostras',
    label: 'Visita técnica ou amostra',
    patterns: [/visita\s+t[ée]cnica|vistoria/i, /amostra|prova\s+de\s+conceito|teste\s+de\s+qualidade/i],
  },
  {
    key: 'exigenciasEspecificas',
    label: 'Exigências específicas',
    patterns: [/exig[êe]ncia\s+espec[íi]fica/i, /atestado|declara[çc][ãa]o\s+de\s+que|compromisso/i],
  },
  {
    key: 'quemPodeParticipar',
    label: 'Quem pode participar',
    patterns: [/poder[ãa]o\s+participar|podem\s+participar|interessados?\s+em\s+participar/i, /microempresa|empresa\s+de\s+pequeno\s+porte|\bME\b|\bEPP\b/i, /cons[óo]rcio/i],
  },
];

type Buckets = {
  quemPodeParticipar: SourcedItem[];
  habilitacaoJuridica: SourcedItem[];
  habilitacaoFiscalTrabalhista: SourcedItem[];
  qualificacaoTecnica: SourcedItem[];
  qualificacaoEconomicoFinanceira: SourcedItem[];
  certidoes: SourcedItem[];
  documentos: SourcedItem[];
  restricoes: SourcedItem[];
  exigenciasEspecificas: SourcedItem[];
  visitasOuAmostras: SourcedItem[];
};

function emptyBuckets(): Buckets {
  return {
    quemPodeParticipar: [],
    habilitacaoJuridica: [],
    habilitacaoFiscalTrabalhista: [],
    qualificacaoTecnica: [],
    qualificacaoEconomicoFinanceira: [],
    certidoes: [],
    documentos: [],
    restricoes: [],
    exigenciasEspecificas: [],
    visitasOuAmostras: [],
  };
}

function clean(line: string): string {
  return line.replace(/\s+/g, ' ').replace(/^[-•*\u2022\s]+/, '').trim();
}

function isNoise(line: string): boolean {
  const text = clean(line);
  if (text.length < 12) return true;
  if (/^(p[áa]gina|page|\d+)\s*$/i.test(text)) return true;
  if (/^[.\-_=]{3,}$/.test(text)) return true;
  return false;
}

/** Extrai frases de requisito: linhas com tamanho útil, com página de origem. */
function collectLines(document: ExtractedDocument): PageHit[] {
  const hits: PageHit[] = [];
  for (const page of document.pages) {
    for (const rawLine of page.text.split('\n')) {
      const line = clean(rawLine);
      if (isNoise(line)) continue;
      hits.push({ page: page.page, text: line });
    }
  }
  return hits;
}

function truncate(text: string, max: number): string {
  const value = clean(text);
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function toBrDate(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  let y = Number(year);
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1990 || y > 2100) return null;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function parseDateToIso(br: string): number {
  const [d, m, y] = br.split('/').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

function normalizeCurrency(raw: string): string {
  const digits = raw.replace(/[^\d,]/g, '');
  const value = Number(digits.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(value)) return raw.trim();
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function found(value: string, source?: string, quote?: string): Evidence {
  return { status: 'found', value: clean(value), source: source ?? null, quote: quote ?? null };
}

const notFound = (): Evidence => ({ status: 'not_found', value: null });

function pushUnique(list: SourcedItem[], item: SourcedItem, max = 40): void {
  const key = item.text.toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
  if (list.some((entry) => entry.text.toLowerCase().replace(/\s+/g, ' ').slice(0, 120) === key)) return;
  if (list.length < max) list.push(item);
}

/**
 * Analisa o documento usando apenas padrões léxicos.
 * A análise resultante é honesta: tudo que não foi encontrado fica como
 * "not_found" e a interface avisa que o motor local está ativo.
 */
export function analyzeLocally(
  document: ExtractedDocument,
  options: { fileName: string; dataAnalise: string },
): AnaliseEditais {
  const lines = collectLines(document);
  const rawText = document.pages.map((page) => page.text).join('\n');
  const buckets = emptyBuckets();

  /* -------------------------- Identificação -------------------------- */
  const orgaoLine = lines.find((hit) =>
    /(prefeitura|munic[íi]pio|c[âa]mara|universidade|instituto|secretaria|tribunal|minist[ée]rio|departamento|funda[çc][ãa]o|autarquia|companhia|empresa\s+(?:p[úu]blica|brasileira)|servi[çc]o\s+nacional|hospital|pol[íi]cia|corpo\s+de\s+bombeiros|governo\s+do\s+estado|estado\s+de|cons[óo]rcio\s+p[úu]blico)/i.test(
      hit.text,
    ),
  );

  const numeroMatch =
    rawText.match(/edital\s*(?:de\s+licita[çc][ãa]o\s*)?n?[º°.:]?\s*([0-9]{1,6}\s*\/\s*[0-9]{2,4})/i) ??
    rawText.match(/preg[ãa]o\s+eletr[ôo]nico\s*n?[º°.:]?\s*([0-9]{1,6}\s*\/\s*[0-9]{2,4})/i) ??
    rawText.match(/\b(\d{1,6}\/\d{4})\b/);
  const numeroEdital = numeroMatch?.[1]?.replace(/\s+/g, '') ?? null;
  const numeroSource = numeroMatch
    ? lines.find((hit) => hit.text.includes(numeroMatch[1]))?.page
    : undefined;

  const processoMatch = rawText.match(
    /processo\s*(?:administrativo|licitat[óo]rio)?\s*n?[º°.:]?\s*([0-9.\-/\s]{6,30})/i,
  );
  const processo = processoMatch?.[1]?.trim().replace(/\s*$/, '') ?? null;

  const modalidadeHit = MODALIDADES.map(([label, regex]) => ({ label, match: regex.exec(rawText) })).find(
    (entry) => entry.match,
  );
  const modalidade = modalidadeHit?.label ?? null;
  const modalidadePage = modalidadeHit
    ? lines.find((hit) => MODALIDADES.find(([l]) => l === modalidadeHit.label)?.[1].test(hit.text))?.page
    : undefined;

  const portalMatch = rawText.match(
    /(https?:\/\/[^\s,;)]+)|((?:www\.)[^\s,;)]+)|(portal\s+nacional\s+de\s+contrata[çc][õo]es\s+p[úu]blicas|comprasnet|compras\.br|licita[çc][õo]es-e|bll|bec\/sp|licitamais)/i,
  );
  const portal = portalMatch?.[0] ?? null;

  const objetoMatch =
    rawText.match(
      /objeto[^\n:]{0,40}:?\s*([\s\S]{40,1200}?)(?:\n\s*\n|\n\s*\d+\.\s|\n\s*[A-Z][A-Z\s]{6,}\n)/i,
    ) ?? rawText.match(/1\.\s*DO\s+OBJETO\s*([\s\S]{40,1500}?)(?:\n\s*2\.|\n\s*\n)/i);
  const objetoTexto = objetoMatch?.[1] ? truncate(objetoMatch[1], 1200) : '';
  const objetoPage = objetoMatch
    ? lines.find((hit) => objetoTexto.slice(0, 40).includes(hit.text.slice(0, 30)))?.page
    : undefined;

  /* ----------------------------- Datas ------------------------------ */
  type Candidato = {
    evento: string;
    data: string;
    hora: string | null;
    page: number;
    prioridade: number;
    horaEfetiva: boolean;
  };

  const candidatos: Candidato[] = [];

  /**
   * Percorre todas as linhas procurando "rótulo + data (hora)".
   * Cobre tanto frases corridas quanto linhas de tabela achatadas pela
   * extração de texto (ex.: "Data de publicação 01/07/2025").
   */
  for (const hit of lines) {
    DATE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DATE_RE.exec(hit.text)) !== null) {
      const br = toBrDate(match[1], match[2], match[3]);
      if (!br) continue;

      const hora = match[4]
        ? `${match[4].padStart(2, '0')}:${(match[5] ?? '00').padStart(2, '0')}`
        : null;
      const dateIndex = hit.text.indexOf(match[0]);
      const label = labelFromLine(hit.text, dateIndex >= 0 ? dateIndex : 0);
      const { evento, prioridade } = classifyEvent(hit.text, label, dateIndex >= 0 ? dateIndex : 0);

      // Sem rótulo confiável nem palavra-chave reconhecida não há marco: melhor
      // omitir do que poluir o cronograma com "Data relevante".
      if (!label && (prioridade === 0 || evento === 'Data relevante')) continue;

      // Data que aparece no meio de uma frase (ex.: "...antes da data de
      // abertura das propostas, ou seja, até 17/07/2025") não é um marco por si
      // só: a palavra-chave encontrada pertence à frase, não ao evento.
      if (!label) {
        const antes = hit.text.slice(0, Math.max(0, dateIndex)).trim();
        const ancora = antes.split(/(?<=[.)])\s+/).pop() ?? antes;
        if (/\bou seja\b|\bisto [ée]\b|\bneste caso\b/i.test(antes)) continue;
        if (/(?:,|\bat[ée]|\bno dia|\bda data|\bdo dia|\bna data)\s*$/i.test(ancora)) continue;
      }

      candidatos.push({
        evento,
        data: br,
        hora,
        page: hit.page,
        prioridade,
        horaEfetiva: Boolean(match[4]),
      });
    }
  }

  // Datas por extenso (ex.: "10 de março de 2025") fora do padrão numérico.
  const longDateRe = /\b(\d{1,2})\s+de\s+([a-zçãéíóúâêô]+)\s+de\s+(\d{4})\b/gi;
  for (const hit of lines) {
    let match: RegExpExecArray | null;
    longDateRe.lastIndex = 0;
    while ((match = longDateRe.exec(hit.text)) !== null) {
      const month = MONTHS[match[2].toLowerCase()];
      if (!month) continue;
      const br = toBrDate(match[1], String(month), match[3]);
      if (!br) continue;
      const label = labelFromLine(hit.text, match.index);
      const { evento, prioridade } = classifyEvent(hit.text, label, match.index);
      candidatos.push({ evento, data: br, hora: null, page: hit.page, prioridade, horaEfetiva: false });
      break;
    }
  }

  // Desempate: para o mesmo evento na mesma data, mantém o candidato mais
  // específico (maior prioridade), com hora explícita e da página mais baixa.
  const melhores = new Map<string, Candidato>();
  for (const candidato of candidatos) {
    const chave = `${candidato.evento}|${candidato.data}`;
    const atual = melhores.get(chave);
    if (!atual) {
      melhores.set(chave, candidato);
      continue;
    }
    const melhor =
      candidato.prioridade > atual.prioridade ||
      (candidato.prioridade === atual.prioridade && candidato.horaEfetiva && !atual.horaEfetiva) ||
      (candidato.prioridade === atual.prioridade &&
        candidato.horaEfetiva === atual.horaEfetiva &&
        candidato.page < atual.page)
        ? candidato
        : atual;
    melhores.set(chave, melhor);
  }

  const cronograma: TimelineEntry[] = [...melhores.values()]
    .map((candidato) => ({
      evento: candidato.evento,
      data: candidato.data,
      hora: candidato.hora,
      status: 'found' as const,
      observacao: null,
      source: `Página ${candidato.page}`,
    }))
    .sort((a, b) => parseDateToIso(a.data) - parseDateToIso(b.data));

  /* ---------------------------- Valores ----------------------------- */
  const valoresEncontrados: Array<{ valor: number; texto: string; page: number; contexto: string }> = [];
  for (const hit of lines) {
    CURRENCY_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CURRENCY_RE.exec(hit.text)) !== null) {
      const texto = normalizeCurrency(match[0]);
      const valor = Number(texto.replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(valor) || valor <= 0) continue;
      valoresEncontrados.push({ valor, texto, page: hit.page, contexto: hit.text });
    }
  }

  const valorGlobal = valoresEncontrados
    .filter((entry) => /total|estimad|m[áa]ximo|global|contrato/i.test(entry.contexto))
    .sort((a, b) => b.valor - a.valor)[0];

  /**
   * Valor estimado: só é tratado como FATO quando o texto ao redor diz
   * "estimado". O maior valor do documento é usado como última alternativa —
   * e, nesse caso, marcado como inferência explícita, porque pode ser uma
   * garantia, um teto de penalidade ou outro valor qualquer.
   */
  const estimadoExplicito = valoresEncontrados.find((entry) => /estimad/i.test(entry.contexto));
  const estimadoInferido = estimadoExplicito ? null : (valorGlobal ?? [...valoresEncontrados].sort((a, b) => b.valor - a.valor)[0]);
  const estimadoHit = estimadoExplicito ?? estimadoInferido;

  const maximoHit = valoresEncontrados.find((entry) => /m[áa]ximo/i.test(entry.contexto));
  const totalHit = valoresEncontrados.find((entry) => /valor\s+total/i.test(entry.contexto));

  /* ----------------------------- Itens ------------------------------ */
  const itens: TenderItem[] = [];
  const UNIDADES = new Set([
    'UN', 'UND', 'UNID', 'CJ', 'CX', 'PT', 'PC', 'PÇ', 'KG', 'G', 'L', 'ML', 'M', 'M2', 'M3', 'MES', 'MÊS',
    'SV', 'SERV', 'HR', 'H', 'DIA', 'KIT', 'PAR', 'RL', 'RESMA', 'FD', 'FR', 'TB', 'GB', 'TB', 'PCT', 'SC',
    'TON', 'T', 'AMP', 'CART', 'BOB', 'GL', 'BL', 'RAM', 'LIC', 'ASSIN', 'VT', 'VD',
  ]);

  /**
   * Linha de item em tabela: "3 Monitor LED 23,8\" Full HD, ... 60 UN Lote 1 R$ ...".
   * A descrição precede a quantidade, que vem seguida da unidade e do lote.
   */
  const itemCompletoRe =
    /^\s*(\d{1,3})\s*[.)\-–]?\s+(.+?)\s{2,}(\d{1,6}(?:[.,]\d{1,3})?)\s+([A-Za-zÀ-ÿ]{1,7})\b\s*(Lote\s*[\w-]+)?/i;

  /** Linha sem quantidade (item quebrado em duas linhas pela tabela). */
  const itemSemQuantidadeRe = /^\s*(\d{1,3})\s+([A-Za-zÀ-ÿ][^\n]{15,200})$/;

  /** Linhas de continuação, que trazem quantidade e unidade separadas. */
  const quantidadeRe = /^\s*(\d{1,6}(?:[.,]\d{1,3})?)\s+([A-Za-zÀ-ÿ]{1,7})\b\s*(Lote\s*[\w-]+)?/i;

  const pareceDescricao = (texto: string): boolean => {
    if (texto.length < 15) return false;
    if (/^(?:p[áa]gina|item|total|valor|observa|anexo|edital|processo|cl[áa]usula|das|dos|art)/i.test(texto)) return false;
    if (/^(?:objeto|licita[çc][ãa]o|contrata[çc][ãa]o)\b/i.test(texto)) return false;
    if ((texto.match(/[a-zà-ÿ]/g) ?? []).length < 12) return false;
    return true;
  };

  for (const page of document.pages) {
    const linhas = page.text.split('\n').map((raw) => clean(raw));
    for (let index = 0; index < linhas.length && itens.length < 60; index += 1) {
      const linha = linhas[index];
      if (linha.length < 15) continue;

      const completa = itemCompletoRe.exec(linha);
      if (completa) {
        const descricao = clean(completa[2]);
        const unidade = (completa[4] ?? '').toUpperCase();
        if (!pareceDescricao(descricao)) {
          // Pode ser um item cuja descrição quebrou na linha seguinte.
          const next = linhas[index + 1] ?? '';
          if (pareceDescricao(next) && UNIDADES.has(unidade)) {
            pushItem(itens, {
              numero: completa[1],
              descricao: truncate(`${descricao} ${clean(next)}`, 200),
              quantidade: completa[3],
              unidade,
              lote: completa[5] ? completeClean(completa[5]) : null,
              source: `Página ${page.page}`,
            });
          }
          continue;
        }
        if (!UNIDADES.has(unidade) && !/^\d/.test(completa[3])) continue;
        pushItem(itens, {
          numero: completa[1],
          descricao: truncate(descricao, 200),
          quantidade: completa[3],
          unidade: UNIDADES.has(unidade) ? unidade : null,
          lote: completa[5] ? completeClean(completa[5]) : null,
          source: `Página ${page.page}`,
        });
        continue;
      }

      const simples = itemSemQuantidadeRe.exec(linha);
      if (simples && pareceDescricao(simples[2])) {
        // A quantidade pode estar na linha seguinte (quebra de tabela).
        const proxima = linhas[index + 1] ?? '';
        const quantidadeMatch = quantidadeRe.exec(proxima);
        const unidade = (quantidadeMatch?.[2] ?? '').toUpperCase();
        pushItem(itens, {
          numero: simples[1],
          descricao: truncate(clean(simples[2]), 200),
          quantidade: quantidadeMatch && UNIDADES.has(unidade) ? quantidadeMatch[1] : null,
          unidade: UNIDADES.has(unidade) ? unidade : null,
          lote: quantidadeMatch?.[3] ? completeClean(quantidadeMatch[3]) : null,
          source: `Página ${page.page}`,
        });
      }
    }
  }

  /* --------------------------- Requisitos --------------------------- */
  for (const hit of lines) {
    for (const bucket of REQUIREMENT_BUCKETS) {
      if (!bucket.patterns.some((pattern) => pattern.test(hit.text))) continue;
      pushUnique(buckets[bucket.key], {
        text: truncate(hit.text, 220),
        source: `Página ${hit.page}`,
      });
    }
  }

  const obrigacoesContratada: SourcedItem[] = [];
  const obrigacoesContratante: SourcedItem[] = [];
  const condicoesPagamento: SourcedItem[] = [];
  const garantias: SourcedItem[] = [];
  const penalidades: SourcedItem[] = [];

  for (const hit of lines) {
    const text = hit.text;
    const source = `Página ${hit.page}`;
    if (/obriga[çc][õo]es\s+(?:da|do)\s+contratad[ao]/i.test(text)) pushUnique(obrigacoesContratada, { text: truncate(text, 220), source });
    if (/obriga[çc][õo]es\s+(?:da|do)\s+contratante|obriga[çc][õo]es\s+da\s+administra[çc][ãa]o/i.test(text)) pushUnique(obrigacoesContratante, { text: truncate(text, 220), source });
    if (/pagamento|faturamento|liquida[çc][ãa]o|nota\s+fiscal|prazo\s+de\s+\d{1,3}\s+dias\s+para\s+pagamento/i.test(text)) pushUnique(condicoesPagamento, { text: truncate(text, 220), source });
    if (/garantia|cau[çc][ãa]o|seguro\s+garantia|reten[çc][ãa]o/i.test(text)) pushUnique(garantias, { text: truncate(text, 220), source });
    if (/multa|penalidade|san[çc][ãa]o|advert[êe]ncia|suspens[ãa]o\s+tempor[áa]ria/i.test(text)) pushUnique(penalidades, { text: truncate(text, 220), source });
  }

  const prazoExecucaoHit = lines.find((hit) =>
    /prazo\s+de\s+(?:execu[çc][ãa]o|vig[êe]ncia)|execu[çc][ãa]o\s+(?:em|no\s+prazo\s+de)|vig[êe]ncia\s+de\s+\d{1,3}\s+meses/i.test(
      hit.text,
    ),
  );
  const prazoEntregaHit = lines.find((hit) => /prazo\s+de\s+entrega|entrega\s+em\s+at[ée]\s+\d{1,3}/i.test(hit.text));

  /* ------------------------ Pontos de atenção ----------------------- */
  const pontos: AttentionPoint[] = [];
  const prazoCritico = cronograma.find((entry) =>
    /encerramento|abertura|sess[ãa]o/i.test(entry.evento),
  );

  if (prazoCritico) {
    pontos.push({
      titulo: `Prazo crítico: ${prazoCritico.evento}`,
      motivo: `A data de ${prazoCritico.data}${prazoCritico.hora ? ` às ${prazoCritico.hora}` : ''} é um marco com consequência direta: perder esse horário implica exclusão do certame, sem possibilidade de complementação posterior.`,
      nivel: 'alto',
      recomendacao:
        'Bloqueie a agenda da equipe responsável e finalize a montagem da proposta com pelo menos 24 horas de antecedência. O envio costuma ser eletrônico e depende de certificado digital válido.',
      trecho: null,
      source: prazoCritico.source ?? null,
    });
  }

  if (!estimadoHit) {
    pontos.push({
      titulo: 'Valor estimado não localizado automaticamente',
      motivo:
        'Nenhum valor global foi identificado no texto extraído. Isso pode indicar que o orçamento está em anexo separado (planilha orçamentária) ou que o documento é um extrato/resumo.',
      nivel: 'medio',
      recomendacao: 'Localize a planilha orçamentária ou o anexo de preços e confirme o valor de referência antes de precificar.',
      trecho: null,
      source: null,
    });
  }

  if (document.totalPages > 120) {
    pontos.push({
      titulo: 'Documento extenso — risco de exigência esquecida',
      motivo: `O edital tem ${document.totalPages} páginas. A probabilidade de existir uma exigência específica fora das seções principais é alta.`,
      nivel: 'medio',
      recomendacao: 'Faça uma segunda leitura direcionada aos anexos técnicos e ao termo de referência antes de enviar a proposta.',
      trecho: null,
      source: null,
    });
  }

  for (const item of buckets.qualificacaoTecnica.slice(0, 2)) {
    pontos.push({
      titulo: 'Exigência de qualificação técnica que pode eliminar a proposta',
      motivo: `A exigência "${truncate(item.text, 160)}" precisa ser comprovada com documento de terceiro ou atestado registrado. É o tipo de requisito que, quando não atendido, elimina o proponente na fase de habilitação.`,
      nivel: 'alto',
      recomendacao: 'Verifique com antecedência se sua empresa possui o atestado/acervo exigido e se ele está registrado no conselho competente.',
      trecho: truncate(item.text, 220),
      source: item.source ?? null,
    });
  }

  if (buckets.visitasOuAmostras.length) {
    pontos.push({
      titulo: 'Há exigência de visita técnica ou apresentação de amostra',
      motivo:
        'Visitas e amostras têm janela própria de agendamento e, quando obrigatórias, a não realização pode inabilitar o proponente.',
      nivel: 'medio',
      recomendacao: 'Confirme se a visita é obrigatória ou facultativa e agende imediatamente se for obrigatória.',
      trecho: truncate(buckets.visitasOuAmostras[0].text, 200),
      source: buckets.visitasOuAmostras[0].source ?? null,
    });
  }

  if (penalidades.length) {
    pontos.push({
      titulo: 'Regime de penalidades previsto',
      motivo: `O edital prevê sanções aplicáveis (${penalidades.length} trecho(s) identificado(s)). Multas e sanções podem inviabilizar a operação caso prazos de entrega sejam descumpridos.`,
      nivel: 'medio',
      recomendacao: 'Leia a cláusula integralmente e dimensione a capacidade real de entrega antes de assumir o compromisso.',
      trecho: truncate(penalidades[0].text, 200),
      source: penalidades[0].source ?? null,
    });
  }

  /* ---------------------------- Checklist --------------------------- */
  const checklist: ChecklistEntry[] = [];
  const addChecklist = (item: string, source?: string, obrigatorio = true) => {
    if (checklist.length >= 40) return;
    if (checklist.some((entry) => entry.item.toLowerCase() === item.toLowerCase())) return;
    checklist.push({ item, obrigatorio, source: source ?? null });
  };

  recomendarChecklist(buckets).forEach((entry) =>
    addChecklist(entry.item, entry.source ?? undefined, entry.obrigatorio),
  );

  /* ---------------------------- Confiança --------------------------- */
  const preenchidos = [
    Boolean(orgaoLine),
    Boolean(numeroEdital),
    Boolean(modalidade),
    Boolean(objetoTexto),
    cronograma.length > 0,
    Boolean(estimadoHit),
    buckets.quemPodeParticipar.length > 0,
    buckets.documentos.length + buckets.certidoes.length > 0,
    Boolean(prazoExecucaoHit ?? prazoEntregaHit),
  ].filter(Boolean).length;
  const cobertura = preenchidos / 9;

  const destaques: SourcedItem[] = [];
  if (orgaoLine) destaques.push({ text: `Órgão: ${truncate(orgaoLine.text, 120)}`, source: `Página ${orgaoLine.page}` });
  if (modalidade) destaques.push({ text: `Modalidade: ${modalidade}`, source: modalidadePage ? `Página ${modalidadePage}` : null });
  if (estimadoHit) {
    destaques.push({
      text: `Valor ${estimadoExplicito ? 'estimado' : 'de referência (inferido)'}: ${estimadoHit.texto}`,
      source: `Página ${estimadoHit.page}`,
    });
  }
  if (prazoCritico) destaques.push({ text: `Prazo crítico: ${prazoCritico.data} (${prazoCritico.evento})`, source: prazoCritico.source ?? null });
  if (itens.length) destaques.push({ text: `${itens.length} itens identificados na estrutura de itens do edital`, source: itens[0].source ?? null });

  const avisos = [
    'Motor local ativo: esta análise foi gerada por extração determinística de padrões, sem uso de IA generativa.',
    'Os campos vazios significam que o padrão não foi localizado automaticamente e exigem leitura humana.',
  ];
  if (!process.env.DEEPSEEK_API_KEY) {
    avisos.push('Para habilitar a análise completa com IA, configure DEEPSEEK_API_KEY no arquivo .env.');
  }

  const analise: AnaliseEditais = {
    schemaVersion: '1.0',
    documento: {
      titulo: `Edital ${numeroEdital ?? ''}`.trim() || options.fileName,
      orgao: orgaoLine ? truncate(orgaoLine.text, 160) : null,
      numeroEdital,
      modalidade,
      paginas: document.totalPages,
      caracteres: document.totalChars,
      dataAnalise: options.dataAnalise,
    },
    resumoExecutivo: {
      visaoGeral: buildLocalSummary({
        orgao: orgaoLine?.text ?? null,
        objeto: objetoTexto,
        modalidade,
        valores: estimadoHit?.texto ?? null,
        prazo: prazoCritico ? `${prazoCritico.data} (${prazoCritico.evento})` : null,
        paginas: document.totalPages,
        itens: itens.length,
      }),
      destaques,
      alertaPrazo: prazoCritico
        ? `${prazoCritico.evento} em ${prazoCritico.data}${prazoCritico.hora ? ` às ${prazoCritico.hora}` : ''}.`
        : null,
      recomendacao:
        'Leia integralmente as seções de habilitação e o termo de referência, confirme as exigências de qualificação técnica e valide a planilha orçamentária antes de decidir pela participação.',
    },
    informacoesGerais: {
      orgao: orgaoLine ? found(truncate(orgaoLine.text, 160), `Página ${orgaoLine.page}`) : notFound(),
      numeroEdital: numeroEdital
        ? found(numeroEdital, numeroSource ? `Página ${numeroSource}` : undefined)
        : notFound(),
      modalidade: modalidade
        ? found(modalidade, modalidadePage ? `Página ${modalidadePage}` : undefined)
        : notFound(),
      processo: processo ? found(processo) : notFound(),
      objeto: objetoTexto ? found(objetoTexto, objetoPage ? `Página ${objetoPage}` : undefined) : notFound(),
      portal: portal ? found(portal) : notFound(),
      localDisputa: notFound(),
      regimeExecucao: notFound(),
      criterioJulgamento: (() => {
        const hit = lines.find((line) => /crit[ée]rio\s+de\s+julgamento|menor\s+pre[çc]o|melhor\s+t[ée]cnica/i.test(line.text));
        return hit ? found(truncate(hit.text, 160), `Página ${hit.page}`) : notFound();
      })(),
      vigenciaContrato: (() => {
        const hit = lines.find((line) => /vig[êe]ncia\s+do\s+contrato|prazo\s+de\s+vig[êe]ncia/i.test(line.text));
        return hit ? found(truncate(hit.text, 160), `Página ${hit.page}`) : notFound();
      })(),
    },
    cronograma,
    outrosPrazos: [],
    objeto: {
      resumo: objetoTexto ? truncate(objetoTexto, 400) : 'Não identificado no documento.',
      descricaoDetalhada: objetoTexto || 'Não identificado no documento.',
      itens,
      lotes: (() => {
        const hit = lines.filter((line) => /\blote\s*\d/i.test(line.text)).slice(0, 8);
        return hit.map((entry) => ({ text: truncate(entry.text, 200), source: `Página ${entry.page}` }));
      })(),
      especificacoesTecnicas: (() => {
        const hit = lines
          .filter((line) => /especifica[çc][ãa]o|termo\s+de\s+refer[êe]ncia|memorial\s+descritivo/i.test(line.text))
          .slice(0, 8);
        return hit.map((entry) => ({ text: truncate(entry.text, 200), source: `Página ${entry.page}` }));
      })(),
    },
    participacao: {
      ...buckets,
      consorcio: (() => {
        const hit = lines.find((line) => /cons[óo]rcio/i.test(line.text));
        return hit ? found(truncate(hit.text, 200), `Página ${hit.page}`) : notFound();
      })(),
      meEpp: (() => {
        const hit = lines.find((line) => /microempresa|empresa\s+de\s+pequeno\s+porte|\bME\/EPP\b|complementar\s+n?[º°]?\s*123/i.test(line.text));
        return hit ? found(truncate(hit.text, 200), `Página ${hit.page}`) : notFound();
      })(),
    },
    obrigacoes: {
      contratada: obrigacoesContratada,
      contratante: obrigacoesContratante,
      prazoExecucao: prazoExecucaoHit
        ? found(truncate(prazoExecucaoHit.text, 220), `Página ${prazoExecucaoHit.page}`)
        : notFound(),
      prazoEntrega: prazoEntregaHit
        ? found(truncate(prazoEntregaHit.text, 220), `Página ${prazoEntregaHit.page}`)
        : notFound(),
      condicoesPagamento,
      garantias,
      penalidades,
      sancoes: penalidades,
      subcontratacao: (() => {
        const hit = lines.find((line) => /subcontrata[çc][ãa]o|subcontratar/i.test(line.text));
        return hit ? found(truncate(hit.text, 200), `Página ${hit.page}`) : notFound();
      })(),
    },
    valores: {
      valorEstimado: estimadoExplicito
        ? found(estimadoExplicito.texto, `Página ${estimadoExplicito.page}`, truncate(estimadoExplicito.contexto, 200))
        : estimadoInferido
          ? {
              status: 'inferred',
              value: estimadoInferido.texto,
              source: `Página ${estimadoInferido.page}`,
              quote: truncate(estimadoInferido.contexto, 200),
              reason:
                'O documento não rotula explicitamente um "valor estimado". Este é o maior valor com contexto financeiro localizado; confirme na planilha orçamentária antes de usar como referência.',
            }
          : notFound(),
      valorMaximo: maximoHit
        ? found(maximoHit.texto, `Página ${maximoHit.page}`, truncate(maximoHit.contexto, 200))
        : notFound(),
      moeda: 'BRL',
      itens: [],
      observacoes: totalHit
        ? [{ text: `Valor total localizado: ${totalHit.texto}`, source: `Página ${totalHit.page}` }]
        : [],
    },
    pontosDeAtencao: pontos,
    checklist,
    conclusao: {
      texto: buildLocalConclusion({
        orgao: orgaoLine?.text ?? null,
        modalidade,
        prazo: prazoCritico ? `${prazoCritico.data} (${prazoCritico.evento})` : null,
        valor: estimadoHit?.texto ?? null,
        itens: itens.length,
        exigencias: buckets.qualificacaoTecnica.length + buckets.documentos.length + buckets.certidoes.length,
      }),
      proximosPassos: [
        { text: 'Ler integralmente o termo de referência e os anexos técnicos.', source: null },
        { text: 'Confirmar disponibilidade dos documentos de habilitação com validade na data da sessão.', source: null },
        { text: 'Validar a planilha orçamentária e a composição de custos junto à área técnica.', source: null },
        { text: 'Submeter o edital a validação jurídica antes de assumir compromisso.', source: null },
      ],
      limitacoesDaAnalise: avisos,
    },
    confianca: {
      nivel: cobertura >= 0.7 ? 'media' : 'baixa',
      justificativa: `Analisador local identificou ${preenchidos} de 9 blocos de informação esperados (${Math.round(cobertura * 100)}% de cobertura). A análise não interpreta cláusulas ambíguas.`,
    },
  };

  return analise;
}

function pushItem(list: TenderItem[], item: TenderItem): void {
  const key = `${item.numero ?? ''}|${item.descricao.toLowerCase().slice(0, 80)}`;
  if (list.some((entry) => `${entry.numero ?? ''}|${entry.descricao.toLowerCase().slice(0, 80)}` === key)) return;
  list.push(item);
}

/** Padroniza o rótulo de lote ("Lote 1" / "lote 1" → "Lote 1"). */
function completeClean(value: string): string {
  return clean(value).replace(/^lote\s*/i, 'Lote ').trim();
}

function recomendarChecklist(buckets: Buckets): ChecklistEntry[] {
  const entries: ChecklistEntry[] = [];
  const add = (item: string, source?: string, obrigatorio = true) =>
    entries.push({ item, obrigatorio, source: source ?? null });

  add('Cadastro ativo no portal de compras do órgão (com certificado digital válido)');
  add('Certidão de regularidade fiscal federal (Receita Federal / PGFN)');
  add('Certidão de regularidade do FGTS (CRF)');
  add('Certidão de regularidade trabalhista (CNDT)');
  add('Certidão negativa de falência e concordata');
  add('Contrato social / estatuto e última alteração registrada');
  add('Documentos de identificação dos sócios e procuração do representante');

  for (const entry of buckets.qualificacaoTecnica.slice(0, 5)) add(`[Técnica] ${truncate(entry.text, 180)}`, entry.source ?? undefined);
  for (const entry of buckets.qualificacaoEconomicoFinanceira.slice(0, 4)) add(`[Econômico-financeira] ${truncate(entry.text, 180)}`, entry.source ?? undefined);
  for (const entry of buckets.certidoes.slice(0, 4)) add(`[Certidão] ${truncate(entry.text, 180)}`, entry.source ?? undefined);
  for (const entry of buckets.documentos.slice(0, 6)) add(`[Documento] ${truncate(entry.text, 180)}`, entry.source ?? undefined);
  for (const entry of buckets.exigenciasEspecificas.slice(0, 4)) add(`[Exigência] ${truncate(entry.text, 180)}`, entry.source ?? undefined);
  for (const entry of buckets.visitasOuAmostras.slice(0, 3)) add(`[Visita/Amostra] ${truncate(entry.text, 180)}`, entry.source ?? undefined, false);

  return entries;
}

function buildLocalSummary(input: {
  orgao: string | null;
  objeto: string;
  modalidade: string | null;
  valores: string | null;
  prazo: string | null;
  paginas: number;
  itens: number;
}): string {
  const parts: string[] = [];
  parts.push(
    input.orgao
      ? `${input.orgao} publicou ${input.modalidade ? `um ${input.modalidade.toLowerCase()}` : 'um processo licitatório'} com ${input.paginas} páginas.`
      : `O documento analisado possui ${input.paginas} páginas e aparenta ser um instrumento convocatório.`,
  );
  if (input.objeto) parts.push(`Objeto identificado: ${truncate(input.objeto, 320)}`);
  if (input.valores) parts.push(`Valor de referência localizado: ${input.valores}.`);
  if (input.itens) parts.push(`A estrutura de itens permitiu identificar ${input.itens} item(ns).`);
  parts.push(
    input.prazo
      ? `O marco temporal mais relevante é ${input.prazo}, que deve ser tratado como limite duro para a equipe.`
      : 'Não foi possível identificar automaticamente a data de encerramento das propostas — confirme no cronograma oficial do edital.',
  );
  parts.push(
    'Esta leitura foi produzida pelo motor local de extração (sem IA generativa) e serve como ponto de partida: os campos não preenchidos dependem de conferência humana.',
  );
  return parts.join(' ');
}

function buildLocalConclusion(input: {
  orgao: string | null;
  modalidade: string | null;
  prazo: string | null;
  valor: string | null;
  itens: number;
  exigencias: number;
}): string {
  return [
    `O documento trata de ${input.modalidade ? input.modalidade.toLowerCase() : 'procedimento licitatório'}${input.orgao ? ` conduzido por ${input.orgao}` : ''}.`,
    input.valor ? `O valor de referência localizado foi ${input.valor}.` : 'O valor de referência não foi localizado automaticamente.',
    input.prazo ? `O prazo mais crítico identificado é ${input.prazo}.` : 'O cronograma não pôde ser reconstruído automaticamente.',
    input.itens ? `Foram identificados ${input.itens} itens na estrutura do objeto.` : '',
    input.exigencias ? `Foram localizados ${input.exigencias} trechos com exigências de habilitação ou documentação.` : '',
    'A decisão de participar depende de validação humana dos requisitos de habilitação e da viabilidade econômica da proposta.',
  ]
    .filter(Boolean)
    .join(' ');
}
