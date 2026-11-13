import { config } from './config';
import { buildDemoEditalPdf } from './fixtures/demo-edital';

let cached: Buffer | undefined;

/** PDF fictício usado na demonstração comercial (gerado e memoizado). */
export function getDemoPdf(): { buffer: Buffer; fileName: string } {
  cached ??= buildDemoEditalPdf();
  return { buffer: cached, fileName: config.app.demoFile };
}
