'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2,
  Plus,
  Printer,
  Share2,
  Trash2,
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

  // === Actions sur les items ===
  async function setQty(itemKey: string, quantity: number | null) {
    try {
      const res = await fetch(
        `/api/shopping-list/items/${encodeURIComponent(itemKey)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quantity }),
        },
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error);
      setList(j.list);
      window.dispatchEvent(new CustomEvent('shopping-list-updated'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }
  async function deleteItem(itemKey: string) {
    try {
      const res = await fetch(
        `/api/shopping-list/items/${encodeURIComponent(itemKey)}`,
        { method: 'DELETE' },
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error);
      setList(j.list);
      window.dispatchEvent(new CustomEvent('shopping-list-updated'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }
  async function addManual(payload: {
    label: string;
    category: string;
    quantity: number | null;
    unit: string | null;
  }) {
    try {
      const res = await fetch('/api/shopping-list/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, note: null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error);
      setList(j.list);
      window.dispatchEvent(new CustomEvent('shopping-list-updated'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }

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
                      <EditableItemRow
                        key={it.key}
                        item={it}
                        onSetQty={(q) => setQty(it.key, q)}
                        onDelete={() => deleteItem(it.key)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Bouton ajouter ingrédient — toujours dispo, même liste vide */}
          {!loading && !error && (
            <AddIngredientInline
              defaultCategory={grouped[0]?.[0] ?? 'Divers'}
              onAdd={addManual}
            />
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

/**
 * Ligne d'un item de la liste avec :
 *   - case déco (esthétique liste de courses)
 *   - input quantity éditable (commit on blur ou Enter)
 *   - label
 *   - corbeille
 */
function EditableItemRow({
  item,
  onSetQty,
  onDelete,
}: {
  item: ShoppingListV2Item;
  onSetQty: (q: number | null) => void;
  onDelete: () => void;
}) {
  const [qtyDraft, setQtyDraft] = useState<string>(
    item.totalQuantity == null
      ? ''
      : String(Math.round(item.totalQuantity * 100) / 100),
  );
  const [confirmDel, setConfirmDel] = useState(false);

  // Sync local quand l'item change côté server (après refresh).
  useEffect(() => {
    setQtyDraft(
      item.totalQuantity == null
        ? ''
        : String(Math.round(item.totalQuantity * 100) / 100),
    );
  }, [item.totalQuantity]);

  function commitQty() {
    const parsed = qtyDraft.trim() === '' ? null : Number(qtyDraft);
    const current = item.totalQuantity;
    // Pas de change → no-op
    if (parsed === current) return;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setQtyDraft(current == null ? '' : String(current));
      return;
    }
    onSetQty(parsed);
  }

  return (
    <li className="flex items-center gap-2 py-1.5">
      <span
        aria-hidden
        className={`grid h-4 w-4 shrink-0 place-items-center rounded border-2 ${
          item.checked
            ? 'border-coral bg-coral text-white'
            : 'border-coral-soft bg-white'
        }`}
      >
        {item.checked && <span className="text-[0.5rem] font-bold">✓</span>}
      </span>
      {/* Input qty seulement si l'item AVAIT une quantité (pas pour
          les pantry sans qty type "huile d'olive"). */}
      {item.totalQuantity != null ? (
        <input
          type="number"
          step="0.5"
          min="0"
          value={qtyDraft}
          onChange={(e) => setQtyDraft(e.target.value)}
          onBlur={commitQty}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="h-7 w-14 rounded-md border border-cream bg-white px-1.5 text-center text-xs focus:border-coral focus:outline-none"
        />
      ) : (
        <span aria-hidden className="w-14 shrink-0" />
      )}
      <span
        className={`flex-1 text-sm text-ink ${
          item.checked ? 'line-through opacity-50' : ''
        }`}
      >
        {item.unit ? `${item.unit} ${item.label}` : item.label}
        {item.note && (
          <span className="block text-xs italic text-ink-soft">{item.note}</span>
        )}
      </span>
      {confirmDel ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setConfirmDel(false)}
            aria-label="Annuler"
            className="rounded-full bg-cream px-2 py-1 text-[0.65rem] font-semibold text-ink-soft"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmDel(false);
              onDelete();
            }}
            className="rounded-full bg-red-600 px-2 py-1 text-[0.65rem] font-bold text-white"
          >
            OK
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDel(true)}
          aria-label="Supprimer cet article"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

/** Mini-form inline pour ajouter un ingrédient manuellement. */
function AddIngredientInline({
  defaultCategory,
  onAdd,
}: {
  defaultCategory: string;
  onAdd: (payload: {
    label: string;
    category: string;
    quantity: number | null;
    unit: string | null;
  }) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState(defaultCategory);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await onAdd({
        label: label.trim(),
        category: category.trim() || 'Divers',
        quantity: qty.trim() === '' ? null : Number(qty),
        unit: unit.trim() || null,
      });
      setLabel('');
      setQty('');
      setUnit('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-coral-soft/60 bg-cream/40 px-4 py-2.5 text-xs font-semibold text-coral-dark transition hover:bg-cream/70"
      >
        <Plus className="h-3.5 w-3.5" />
        Ajouter un ingrédient
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-coral-soft/60 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-[3rem_3rem_1fr] gap-1.5">
        <input
          type="number"
          step="0.5"
          min="0"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="Qté"
          className="h-8 rounded-md border border-cream bg-white px-1 text-center text-xs focus:border-coral focus:outline-none"
        />
        <input
          type="text"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="g/cl"
          className="h-8 rounded-md border border-cream bg-white px-1 text-center text-xs focus:border-coral focus:outline-none"
        />
        <input
          autoFocus
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Nom de l'article"
          className="h-8 rounded-md border border-cream bg-white px-2 text-xs focus:border-coral focus:outline-none"
        />
      </div>
      <input
        type="text"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="Catégorie"
        className="mt-1.5 h-8 w-full rounded-md border border-cream bg-white px-2 text-xs focus:border-coral focus:outline-none"
      />
      <div className="mt-2 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-full border border-cream bg-white px-3 py-1 text-[0.7rem] font-semibold text-ink-soft"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !label.trim()}
          className="rounded-full bg-coral px-3 py-1 text-[0.7rem] font-bold text-white disabled:opacity-50"
        >
          Ajouter
        </button>
      </div>
    </div>
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
