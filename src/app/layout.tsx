import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'LicitaFlow · Inteligência em licitações',
    template: '%s · LicitaFlow',
  },
  description:
    'Plataforma de licitações: radar de editais do PNCP com nota de aderência, preços vencedores de licitações anteriores, pipeline de disputas, cofre de certidões e análise de edital com IA.',
  applicationName: 'LicitaFlow',
  keywords: [
    'licitação',
    'edital',
    'PNCP',
    'pregão eletrônico',
    'preço de referência',
    'certidões',
    'análise de editais',
    'inteligência artificial',
    'Lei 14.133/2021',
  ],
  robots: { index: false, follow: false },
  openGraph: {
    title: 'LicitaFlow · Inteligência em licitações',
    description:
      'Encontre editais aderentes no PNCP, descubra quanto os concorrentes ofertaram e organize documentos e prazos em um só lugar.',
    type: 'website',
    locale: 'pt_BR',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
