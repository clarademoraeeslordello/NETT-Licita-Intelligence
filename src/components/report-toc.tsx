'use client';

import { useEffect, useState } from 'react';
import { IconChevron, IconList } from '@/components/icons';

export type TocEntry = { id: string; label: string; count?: number | null };

/** Sumário lateral com destaque da seção visível (scroll spy). */
export function ReportToc({ entries }: { entries: TocEntry[] }) {
  const [active, setActive] = useState(entries[0]?.id ?? '');
  const [open, setOpen] = useState(false);
  // Dependência estável: as `entries` são recriadas a cada render do servidor,
  // então observamos apenas os identificadores.
  const idKey = entries.map((entry) => entry.id).join('|');

  useEffect(() => {
    const ids = idKey.split('|').filter(Boolean);
    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((record) => record.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: '-96px 0px -65% 0px', threshold: [0, 1] },
    );

    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [idKey]);

  return (
    <nav aria-label="Seções do relatório" className="no-print">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="toc-list"
        className="flex w-full items-center justify-between rounded-xl border border-nett-text-muted/15 bg-nett-surface px-4 py-3 text-sm font-medium text-nett-text xl:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <IconList size={16} />
          Seções do relatório
        </span>
        <IconChevron size={16} className={open ? 'rotate-90 transition' : 'transition'} />
      </button>

      <ol
        id="toc-list"
        className={`${open ? 'block' : 'hidden'} mt-2 space-y-1 rounded-2xl border border-nett-text-muted/15 bg-nett-surface p-3 xl:sticky xl:top-24 xl:block xl:border-none xl:bg-transparent xl:p-0`}
      >
        {entries.map((entry) => {
          const isActive = active === entry.id;
          return (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-nett-gold/10 font-medium text-nett-gold-light'
                    : 'text-nett-text hover:bg-nett-raised hover:text-nett-text'
                }`}
              >
                <span>{entry.label}</span>
                {entry.count ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      isActive ? 'bg-nett-gold/20 text-nett-gold-light' : 'bg-nett-raised text-nett-text-muted'
                    }`}
                  >
                    {entry.count}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
