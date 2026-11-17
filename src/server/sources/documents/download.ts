/**
 * Download seguro de documentos de edital (T-203): só origem HTTPS do PNCP, sem SSRF, com limite de tamanho,
 * tempo e tipo (conferido pelo CONTEÚDO, não pelo cabeçalho `Content-Type`, que a origem controla).
 *
 * Defesas:
 *  - allowlist de host (`urlDocumentoPermitida`): HTTPS e `pncp.gov.br` / `*.pncp.gov.br`; IP literal nunca passa;
 *  - o nome é resolvido e TODOS os endereços devem ser públicos (bloqueia loopback, privado, link-local,
 *    metadados de nuvem 169.254.169.254, CGNAT, multicast, IPv6 ULA/link-local e IPv4 mapeado em IPv6);
 *  - redirecionamento manual, no máximo 3 saltos, cada `Location` passa pelas mesmas verificações;
 *  - tamanho máximo (cabeçalho e leitura em fluxo, abortando ao passar do limite), timeout por requisição;
 *  - respeita o espaçamento mínimo entre chamadas ao PNCP (`PNCP_MIN_INTERVAL_MS`);
 *  - HTTP 429 não é retentado (`DocumentRateLimited`): quem chama espera o cooldown.
 * Resíduo conhecido: o `fetch` resolve o nome de novo (janela de DNS rebinding); a allowlist de domínio do PNCP,
 * que a origem não controla, é a defesa principal e a checagem de endereço é defesa em profundidade.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { aguardarVez } from '@/lib/pncp/client';
import { urlDocumentoPermitida } from '../pncp/normalize';

export const DOCUMENT_MAX_BYTES = Number(process.env.DOCUMENT_MAX_BYTES ?? 50 * 1024 * 1024);
export const DOCUMENT_TIMEOUT_MS = Number(process.env.DOCUMENT_FETCH_TIMEOUT_MS ?? 60_000);
export const MAX_REDIRECTS = 3;
export const RATE_LIMIT_COOLDOWN_MS = Number(process.env.PNCP_429_COOLDOWN_MS ?? 15 * 60_000);

export type RejectReason = 'url_not_allowed' | 'private_address' | 'too_many_redirects' | 'not_found' | 'bad_status' | 'too_large' | 'empty' | 'mime_not_allowed';

/** Rejeição definitiva: repetir não muda o resultado (não retentar). */
export class DocumentRejected extends Error {
  constructor(
    readonly reason: RejectReason,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentRejected';
  }
}
/** A origem limitou as requisições (429). Nunca retentar; retomar depois do cooldown. */
export class DocumentRateLimited extends Error {
  constructor(readonly cooldownMs = RATE_LIMIT_COOLDOWN_MS) {
    super('PNCP respondeu 429 ao baixar documento');
    this.name = 'DocumentRateLimited';
  }
}
/** Falha passageira (rede, 5xx, timeout, DNS): o pg-boss retenta com backoff. */
export class DocumentTransient extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DocumentTransient';
  }
}

/** Endereço IP não roteável publicamente? (IPv4 e IPv6) */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split('.').map(Number) as [number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local e metadados de nuvem
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast, reservado, broadcast
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapeado) return isPrivateAddress(mapeado[1]!);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(x);
    if (hex) {
      const n = (parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16);
      return isPrivateAddress(`${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`);
    }
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');
  }
  return true; // não é IP: tratar como inválido
}

export type Lookup = (hostname: string) => Promise<string[]>;
const resolverNome: Lookup = async (hostname) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

async function exigirHostPublico(hostname: string, lookup: Lookup): Promise<void> {
  if (isIP(hostname.replace(/^\[|\]$/g, ''))) throw new DocumentRejected('private_address', 'host por IP literal não é permitido');
  let enderecos: string[];
  try {
    enderecos = await lookup(hostname);
  } catch (error) {
    throw new DocumentTransient(`DNS falhou para ${hostname}`, error);
  }
  if (!enderecos.length || enderecos.some(isPrivateAddress)) throw new DocumentRejected('private_address', `${hostname} resolve para endereço não público`);
}

export type DownloadDeps = {
  fetch?: typeof fetch;
  lookup?: Lookup;
  maxBytes?: number;
  timeoutMs?: number;
  /** Espera entre requisições (padrão: espaçamento global do PNCP). */
  throttle?: () => Promise<void>;
};

async function lerLimitado(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > max) throw new DocumentRejected('too_large', `documento maior que ${max} bytes`);
    return buf;
  }
  const reader = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new DocumentRejected('too_large', `documento maior que ${max} bytes`);
    }
    partes.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  return out;
}

export type Downloaded = { bytes: Uint8Array; finalUrl: string };

export async function downloadDocument(url: string, deps: DownloadDeps = {}): Promise<Downloaded> {
  const doFetch = deps.fetch ?? fetch;
  const lookup = deps.lookup ?? resolverNome;
  const max = deps.maxBytes ?? DOCUMENT_MAX_BYTES;
  const timeout = deps.timeoutMs ?? DOCUMENT_TIMEOUT_MS;
  const throttle = deps.throttle ?? aguardarVez;

  let atual = url;
  for (let salto = 0; salto <= MAX_REDIRECTS; salto += 1) {
    if (!urlDocumentoPermitida(atual)) throw new DocumentRejected('url_not_allowed', 'URL fora da origem permitida (HTTPS do PNCP)');
    await exigirHostPublico(new URL(atual).hostname, lookup);
    await throttle();

    let res: Response;
    try {
      res = await doFetch(atual, { redirect: 'manual', headers: { accept: '*/*' }, signal: AbortSignal.timeout(timeout), cache: 'no-store' });
    } catch (error) {
      throw new DocumentTransient('falha de rede ao baixar documento', error);
    }

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      const destino = res.headers.get('location');
      if (!destino) throw new DocumentRejected('bad_status', `HTTP ${res.status} sem Location`);
      atual = new URL(destino, atual).toString(); // revalidado no início da volta
      continue;
    }
    if (res.status === 429) {
      await res.body?.cancel().catch(() => {});
      throw new DocumentRateLimited();
    }
    if (res.status === 404 || res.status === 410 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      throw new DocumentRejected('not_found', `HTTP ${res.status}`);
    }
    if (res.status >= 500) {
      await res.body?.cancel().catch(() => {});
      throw new DocumentTransient(`PNCP respondeu ${res.status}`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new DocumentRejected('bad_status', `HTTP ${res.status}`);
    }
    const declarado = Number(res.headers.get('content-length'));
    if (Number.isFinite(declarado) && declarado > max) {
      await res.body?.cancel().catch(() => {});
      throw new DocumentRejected('too_large', `documento declara ${declarado} bytes (limite ${max})`);
    }
    try {
      return { bytes: await lerLimitado(res, max), finalUrl: atual };
    } catch (error) {
      if (error instanceof DocumentRejected) throw error;
      throw new DocumentTransient('falha ao ler o documento', error);
    }
  }
  throw new DocumentRejected('too_many_redirects', `mais de ${MAX_REDIRECTS} redirecionamentos`);
}

/* ------------------------------ tipo por conteúdo ------------------------------ */

export type Sniffed = { mime: string; ext: string; extractable: boolean };

const startsWith = (b: Uint8Array, bytes: number[], from = 0) => bytes.every((x, i) => b[from + i] === x);
const extensaoDe = (title: string) => /\.([a-z0-9]{1,5})\s*$/i.exec(title.trim())?.[1]?.toLowerCase() ?? '';

const OOXML: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

/**
 * Identifica o tipo pelos bytes. `null` = não permitido (HTML de erro, executável, binário desconhecido).
 * O título só desempata contêineres (ZIP → docx/xlsx/odt/ods; OLE → doc/xls).
 */
export function sniffDocument(bytes: Uint8Array, title: string): Sniffed | null {
  if (bytes.byteLength === 0) return null;
  const ext = extensaoDe(title);
  const cabeca = bytes.subarray(0, 1024);
  if (cabeca.length >= 5) for (let i = 0; i + 5 <= cabeca.length; i += 1) if (startsWith(cabeca, [0x25, 0x50, 0x44, 0x46, 0x2d], i)) return { mime: 'application/pdf', ext: 'pdf', extractable: true };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const mime = OOXML[ext];
    return mime ? { mime, ext, extractable: true } : { mime: 'application/zip', ext: 'zip', extractable: false };
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return ext === 'xls' ? { mime: 'application/vnd.ms-excel', ext: 'xls', extractable: true } : { mime: 'application/msword', ext: 'doc', extractable: true };
  }
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return { mime: 'application/vnd.rar', ext: 'rar', extractable: false };
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { mime: 'application/x-7z-compressed', ext: '7z', extractable: false };
  if ((ext === 'txt' || ext === 'csv') && !bytes.subarray(0, 8192).includes(0)) return { mime: 'text/plain', ext: 'txt', extractable: true };
  return null;
}
