'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2,
  Printer,
  Share2,
  X,
} from 'lucide-react';
import type {
  ShoppingListV2,
  ShoppingListV2Item,
} from '@/data/shopping-lists';

type Props = {
  onClose: () => void;
};

/**
 * Overlay pour visualiser rapidement la liste de courses active de
 * l'utilisateur (sans quitter la page recette).
 *
 *   - Plein écran avec backdrop semi-transparent
 *   - Liste groupée par catégorie (items + cocher état lecture seule)
 *   - Actions : Partager (Web Share API native ou copie lien),
 *               Imprimer (window.print sur la zone uniquement)
 *   - Lien vers la page /courses complète pour modifications
 */
export function MyShoppingListOverlay({ onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [list, setList] = useState<ShoppingListV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/shopping-list');
        if (!res.ok) throw new Error();
        const j = await res.json();
        if (cancelled) return;
        setList(j.list ?? null);
      } catch {
        if (!cancelled) setError('Impossible de charger ta liste.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    if (!list) return [];
    const map = new Map<string, ShoppingListV2Item[]>();
    for (const it of list.items) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return [...map.entries()];
  }, [list]);

  async function handleShare() {
    if (!list) return;
    const text = formatPlainText(list);
    const shareData = {
      title: list.name,
      text,
      url: typeof window !== 'undefined' ? window.location.origin + '/courses' : '',
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareToast('Liste copiée');
      setTimeout(() => setShareToast(null), 2000);
    } catch {
      /* ignore */
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-black/60 p-4 backdrop-blur-sm print:bg-white print:p-0 print:backdrop-blur-none"
      role="dialog"
      aria-modal="true"
      aria-label="Ma liste de courses"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-shopping-list relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl print:max-h-none print:max-w-none print:rounded-none print:shadow-none"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-cream px-5 py-4 print:border-0">
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
              Ma liste de courses
            </p>
            <h2 className="truncate font-script text-2xl text-coral">
              {list?.name ?? '…'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-cream print:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 print:overflow-visible">
          {loading && (
            <div className="grid place-items-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-coral" />
            </div>
          )}
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {!loading && !error && list && list.items.length === 0 && (
            <p className="rounded-lg bg-cream/60 px-3 py-3 text-center text-sm italic text-ink-soft">
              Ta liste est vide. Ajoute des recettes pour commencer !
            </p>
          )}
          {!loading && !error && list && list.items.length > 0 && (
            <div className="space-y-3">
              {grouped.map(([cat, items]) => (
                <div key={cat}>
                  <p className="mb-1 text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
                    {cat}
                  </p>
                  <ul className="divide-y divide-cream">
                    {items.map((it) => (
                      <li key={it.key} className="flex items-start gap-2 py-1.5">
                        <span
                          aria-hidden
                          className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border-2 ${
                            it.checked
                              ? 'border-coral bg-coral text-white'
                              : 'border-coral-soft bg-white'
                          }`}
                        >
                          {it.checked && (
                            <span className="text-[0.5rem] font-bold">✓</span>
                          )}
                        </span>
                        <span
                          className={`text-sm text-ink ${
                            it.checked ? 'line-through opacity-50' : ''
                          }`}
                        >
                          {formatItem(it)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <footer className="flex items-center justify-between gap-2 border-t border-cream bg-cream/40 px-5 py-3 print:hidden">
          <a
            href="/courses"
            className="text-xs font-semibold text-coral-dark underline-offset-2 hover:underline"
          >
            Voir ma liste complète →
          </a>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleShare}
              disabled={!list || list.items.length === 0}
              aria-label="Partager"
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 disabled:opacity-40"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!list || list.items.length === 0}
              aria-label="Imprimer"
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 disabled:opacity-40"
            >
              <Printer className="h-4 w-4" />
            </button>
          </div>
        </footer>

        {shareToast && (
          <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-coral px-3 py-1 text-xs font-bold text-white shadow-lg">
            {shareToast}
          </div>
        )}
      </div>

      {/* CSS print : on cache tout sauf l'overlay et son contenu. */}
      <style>{`
        @media print {
          @page { margin: 1cm; }
          body > *:not(:has(.my-shopping-list)) { display: none !important; }
          .my-shopping-list { position: static !important; max-height: none !important; }
        }
      `}</style>
    </div>,
    document.body,
  );
}

function formatItem(it: ShoppingListV2Item): string {
  const qty = it.totalQuantity;
  if (qty === null) return capitalize(it.label);
  const rounded = qty < 10 ? Math.round(qty * 2) / 2 : Math.round(qty);
  if (it.unit) {
    return `${rounded} ${it.unit} de ${it.label}`;
  }
  return `${rounded} ${it.label}`;
}

function formatPlainText(list: ShoppingListV2): string {
  const lines: string[] = [list.name, ''];
  const map = new Map<string, ShoppingListV2Item[]>();
  for (const it of list.items) {
    if (!map.has(it.category)) map.set(it.category, []);
    map.get(it.category)!.push(it);
  }
  for (const [cat, items] of map) {
    lines.push(`— ${cat} —`);
    for (const it of items) lines.push(`  • ${formatItem(it)}`);
    lines.push('');
  }
  return lines.join('\n');
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
