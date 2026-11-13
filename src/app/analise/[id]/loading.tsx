/**
 * Estado de carregamento da página de análise.
 * Aparece durante a renderização do servidor (que consulta as capacidades do
 * ambiente) para que a navegação nunca pareça travada.
 */
export default function LoadingAnalysis() {
  return (
    <div className="min-h-dvh bg-ink-50">
      <header className="sticky top-0 z-40 border-b border-ink-200/70 glass">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-5 py-3">
          <div className="skeleton size-9 rounded-xl" />
          <div className="space-y-2">
            <div className="skeleton h-3 w-52 rounded-full" />
            <div className="skeleton h-2.5 w-36 rounded-full" />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <div className="hidden space-y-2 xl:block">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="skeleton h-9 rounded-xl" />
          ))}
        </div>

        <main className="min-w-0 space-y-5">
          <section className="rounded-3xl border border-ink-200 bg-white p-6 shadow-soft">
            <div className="skeleton h-3 w-32 rounded-full" />
            <div className="skeleton mt-4 h-7 w-2/3 rounded-lg" />
            <div className="skeleton mt-3 h-3 w-1/2 rounded-full" />
            <div className="skeleton mt-5 h-16 w-full rounded-2xl" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="skeleton h-24 rounded-2xl" />
              ))}
            </div>
          </section>

          {Array.from({ length: 3 }).map((_, index) => (
            <section key={index} className="rounded-3xl border border-ink-200 bg-white p-6 shadow-soft">
              <div className="flex items-center gap-4">
                <div className="skeleton size-9 rounded-xl" />
                <div className="skeleton h-4 w-48 rounded-full" />
              </div>
              <div className="mt-5 space-y-3">
                <div className="skeleton h-3 w-full rounded-full" />
                <div className="skeleton h-3 w-11/12 rounded-full" />
                <div className="skeleton h-3 w-9/12 rounded-full" />
                <div className="skeleton h-20 w-full rounded-2xl" />
              </div>
            </section>
          ))}

          <p className="text-center text-sm text-ink-500" role="status">
            Montando o relatório da análise…
          </p>
        </main>
      </div>
    </div>
  );
}
