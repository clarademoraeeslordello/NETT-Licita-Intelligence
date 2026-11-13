/**
 * Descoberta e execução de navegador headless para gerar o PDF do relatório.
 *
 * Estratégia: o relatório é renderizado como HTML e impresso com o modo
 * headless do Edge/Chrome já instalado no sistema. Isso entrega um PDF com
 * qualidade tipográfica real (vetorial, com quebras de página controladas)
 * sem adicionar dependências pesadas ao projeto.
 */
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';
import { AppError } from '../errors';

const execFileAsync = promisify(execFile);

const CANDIDATES = [
  process.env.REPORT_BROWSER_PATH,
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env['PROGRAMFILES'] && join(process.env['PROGRAMFILES'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] &&
    join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['LOCALAPPDATA'] &&
    join(process.env['LOCALAPPDATA'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] &&
    join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env['PROGRAMFILES'] &&
    join(process.env['PROGRAMFILES'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((value): value is string => Boolean(value));

// Cache apenas de resultados POSITIVOS: se o navegador for instalado depois, o
// próximo pedido volta a procurar em vez de ficar preso no "não encontrado".
let cachedPath: string | undefined;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Caminho do navegador headless disponível, ou null. */
export async function findBrowser(): Promise<string | null> {
  if (config.report.browserPath) return config.report.browserPath;
  if (cachedPath) return cachedPath;
  for (const candidate of new Set(CANDIDATES)) {
    if (await exists(candidate)) {
      cachedPath = candidate;
      return candidate;
    }
  }
  return null;
}

/** Diagnóstico exposto na interface para explicar por que o PDF está indisponível. */
export async function browserStatus(): Promise<{
  available: boolean;
  path: string | null;
  reason?: string;
}> {
  if (config.report.disabled) {
    return { available: false, path: null, reason: 'Geração de PDF desativada por configuração (REPORT_PDF_DISABLED=true).' };
  }
  const path = await findBrowser();
  if (!path) {
    return {
      available: false,
      path: null,
      reason:
        'Nenhum navegador Chromium/Edge encontrado neste servidor. Defina REPORT_BROWSER_PATH no .env apontando para chrome.exe/msedge.exe.',
    };
  }
  return { available: true, path };
}

/**
 * Converte HTML em PDF usando o modo headless do navegador.
 * O HTML é escrito em arquivo temporário porque o navegador precisa de
 * uma URL `file://` para carregar fontes e estilos locais de forma confiável.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  if (config.report.disabled) {
    throw new AppError('REPORT_BROWSER_MISSING', 'A geração de PDF está desativada neste servidor.', {
      status: 503,
      hint: 'REPORT_PDF_DISABLED está como true. Use o botão "Abrir versão de impressão" e salve como PDF pelo navegador.',
    });
  }

  const browser = await findBrowser();
  if (!browser) {
    throw new AppError('REPORT_BROWSER_MISSING', 'Gerador de PDF indisponível neste ambiente.', {
      status: 503,
      hint: 'Instale o Microsoft Edge/Google Chrome ou configure REPORT_BROWSER_PATH no arquivo .env. O relatório continua disponível pela impressão do navegador.',
    });
  }

  const workDir = await mkdtemp(join(tmpdir(), 'editais-report-'));
  const htmlPath = join(workDir, 'relatorio.html');
  const pdfPath = join(workDir, 'relatorio.pdf');

  try {
    await writeFile(htmlPath, html, 'utf8');

    await execFileAsync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        '--run-all-compositor-stages-before-draw',
        '--virtual-time-budget=8000',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        '--print-to-pdf-no-header',
        `file:///${htmlPath.replace(/\\/g, '/')}`,
      ],
      {
        timeout: config.report.timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
    );

    const pdf = await readFile(pdfPath);
    if (pdf.byteLength < 1024) {
      throw new AppError('REPORT_FAILED', 'O PDF gerado está vazio.', { status: 500 });
    }
    return pdf;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError('REPORT_FAILED', 'Não foi possível gerar o PDF do relatório.', {
      status: 500,
      details: message.slice(0, 500),
      hint: 'Use o botão de impressão do relatório como alternativa.',
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
