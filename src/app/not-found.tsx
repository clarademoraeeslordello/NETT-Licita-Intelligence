import Link from 'next/link';
import { IconAlert, IconDocument, IconRefresh } from '@/components/icons';

/**
 * Página 404 em português.
 * O store de análises é volátil de propósito (memória, TTL de 6 h): um link
 * antigo do relatório é um cenário esperado e precisa explicar o que houve em
 * vez de mostrar o 404 padrão do framework.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-nett-black px-5 py-16">
      <div className="w-full max-w-lg rounded-3xl border border-nett-text-muted/15 bg-nett-surface p-8 text-center shadow-lift">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-nett-gold-dark/18 text-nett-gold-light">
          <IconDocument size={24} />
        </span>

        <h1 className="mt-5 text-2xl font-semibold text-nett-text">Análise não encontrada ou expirada</h1>

        <p className="mt-3 text-[15px] leading-relaxed text-nett-text">
          Os relatórios ficam disponíveis por 30 dias. O PDF enviado não é guardado, só o resultado da análise. Se o
          link é mais antigo que isso ou foi digitado errado, o relatório não pode ser recuperado.
        </p>

        <p className="mt-3 text-sm text-nett-text-muted">
          Se você acabou de analisar um edital, o processamento pode ter sido reiniciado no servidor. Envie o arquivo
          novamente para gerar um novo relatório.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/analisador"
            className="inline-flex items-center gap-2 rounded-xl bg-nett-gold px-5 py-3 text-sm font-medium text-nett-black shadow-soft transition hover:bg-nett-gold-light"
          >
            <IconRefresh size={16} />
            Analisar outro edital
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-nett-text-muted/15 px-5 py-3 text-sm font-medium text-nett-text transition hover:border-nett-text-muted/30 hover:bg-nett-black"
          >
            Ir para o painel
          </Link>
        </div>

        <p className="mt-6 flex items-start justify-center gap-2 text-xs leading-relaxed text-nett-text-muted">
          <IconAlert size={13} className="mt-0.5 shrink-0" />
          Código 404 · recurso inexistente ou removido do servidor
        </p>
      </div>
    </main>
  );
}
