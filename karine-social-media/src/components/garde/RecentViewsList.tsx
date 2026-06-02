/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Trash2 } from 'lucide-react';
import {
  clearRecentViews,
  getRecentViews,
  type RecentView,
} from '@/lib/recent-views';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
  });
}

export function RecentViewsList({ onItemClick }: { onItemClick?: () => void }) {
  const [items, setItems] = useState<RecentView[] | null>(null);

  useEffect(() => {
    setItems(getRecentViews());
  }, []);

  function handleClear() {
    clearRecentViews();
    setItems([]);
  }

  if (items === null) return null;
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-coral-soft/60 bg-white/50 px-3 py-3 text-center text-xs text-ink-soft">
        Aucun contenu consulté récemment.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-soft">
          <Clock className="h-3 w-3" />
          Vu récemment
        </p>
        <button
          type="button"
          onClick={handleClear}
          aria-label="Effacer l’historique"
          className="grid h-6 w-6 place-items-center rounded-full text-ink-soft transition hover:bg-coral-soft/40 hover:text-coral-dark"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <ul className="space-y-1">
        {items.slice(0, 8).map((it) => (
          <li key={`${it.type}-${it.id}`}>
            <Link
              href={it.href}
              onClick={onItemClick}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-coral-soft/40"
            >
              {it.imageUrl ? (
                <img
                  src={it.imageUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-coral-soft/40"
                />
              ) : (
                <span className="h-10 w-10 shrink-0 rounded-lg bg-coral-soft/40" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink">{it.label}</p>
                <p className="text-[0.6rem] text-ink-soft">{timeAgo(it.viewedAt)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
