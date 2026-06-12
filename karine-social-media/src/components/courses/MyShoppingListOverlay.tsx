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
  const [addOpen, setAddOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

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
      if (e.key !== 'Escape') return;
      // Si la modal de confirmation est ouverte, Esc la ferme ELLE,
      // pas l'overlay entier. Si pas de modal ouverte, Esc ferme tout.
      if (confirmClearOpen) {
        setConfirmClearOpen(false);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmClearOpen]);

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
  async function setLabel(itemKey: string, label: string) {
    try {
      const res = await fetch(
        `/api/shopping-list/items/${encodeURIComponent(itemKey)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label }),
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
  /**
   * Impression "user friendly" : ouvre une nouvelle fenêtre avec un
   * HTML minimaliste (juste qty + label par catégorie). Pagination
   * native du navigateur — pas de gestion CSS print de l'app.
   * Pattern déjà éprouvé sur SheetLightbox.
   */
  function handlePrint() {
    if (!list) return;
    const w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) return;
    const title = list.name.replace(/[<>]/g, '');
    const sectionsHtml = renderListHtml(list);
    w.document.write(`<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { size: A4 portrait; margin: 1.2cm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2937; margin: 0; padding: 0; font-size: 11pt; }
  h1 { font-size: 1.4rem; text-align: center; margin: 0 0 0.5cm; color: #b91c1c; font-weight: 600; }
  .meta { text-align: center; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.6cm; }
  h2 { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #b91c1c; margin: 0.5cm 0 0.15cm; border-bottom: 1px solid #fde68a; padding-bottom: 0.1cm; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: flex; align-items: baseline; gap: 0.4cm; padding: 0.12cm 0; border-bottom: 1px dashed #f3f4f6; page-break-inside: avoid; }
  .qty { min-width: 1.5cm; font-weight: 600; color: #1f2937; }
  .qty.empty { color: transparent; }
  .label { flex: 1; }
  .note { display: block; font-style: italic; color: #6b7280; font-size: 0.7rem; }
  section { page-break-inside: avoid; }
</style>
</head><body>
  <h1>🛒 ${title}</h1>
  <p class="meta">Imprimé le ${new Date().toLocaleDateString('fr-FR')}</p>
  ${sectionsHtml}
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 100);
  }

  async function clearAll() {
    setClearing(true);
    try {
      const res = await fetch('/api/shopping-list/clear', { method: 'POST' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error);
      setList(j.list);
      window.dispatchEvent(new CustomEvent('shopping-list-updated'));
      setConfirmClearOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setClearing(false);
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
      // Règle projet ⛔ : pas de fermeture backdrop. Karine coche des
      // items en cours — un tap accidentel ne doit jamais fermer.
      // Utiliser le bouton X dans le header.
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
            {/* Lien "Tout supprimer" — discret, ouvre une modal de
                confirmation non dismissible au click exterieur. */}
            {list && list.items.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClearOpen(true)}
                className="mt-1 flex items-center gap-1 text-[0.7rem] font-semibold text-red-600 underline-offset-2 hover:underline print:hidden"
              >
                <Trash2 className="h-3 w-3" />
                Tout supprimer
              </button>
            )}
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
                        onSetLabel={(l) => setLabel(it.key, l)}
                        onDelete={() => deleteItem(it.key)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Form "ajouter un ingrédient" — apparait AU-DESSUS du footer
            quand l user clique sur le bouton + dans le footer.
            Visible immediatement sans scroll. */}
        {!loading && !error && addOpen && (
          <div className="border-t border-cream bg-white px-5 pb-3 pt-2 print:hidden">
            <AddIngredientForm
              defaultCategory={grouped[0]?.[0] ?? 'Divers'}
              onAdd={async (p) => {
                await addManual(p);
                setAddOpen(false);
              }}
              onCancel={() => setAddOpen(false)}
            />
          </div>
        )}

        {/* Footer actions :
            - Lien texte + Ajouter un ingredient (gauche) : ouvre le
              mini-form au-dessus. Pas un bouton colore (pas explicite),
              juste un lien clair.
            - Partager + Imprimer (droite) en boutons ronds.
            "Voir ma liste complete" retire : redondant (on EST deja
            dans la liste). */}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-cream bg-cream/40 px-5 py-3 print:hidden">
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-coral-dark underline-offset-2 transition hover:underline"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={3} />
            {addOpen ? 'Fermer' : 'Ajouter un ingrédient'}
          </button>
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
              onClick={handlePrint}
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

        {/* Modal de confirmation "Tout supprimer" — NON dismissible au
            click extérieur (volonté Didier 2026-06-03). Esc ne ferme
            pas non plus. Seuls Annuler / Confirmer agissent. */}
        {confirmClearOpen && (
          <div
            className="absolute inset-0 z-10 grid place-items-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-modal-title"
          >
            <div className="w-full max-w-xs space-y-3 rounded-2xl bg-white p-5 shadow-2xl">
              <h3
                id="clear-modal-title"
                className="text-center font-script text-2xl text-coral"
              >
                Vider la liste ?
              </h3>
              <p className="text-center text-sm text-ink-soft">
                Tous les articles, recettes et menus liés seront retirés.
                Cette action est irréversible.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(false)}
                  disabled={clearing}
                  className="flex-1 rounded-full border border-coral-soft bg-white px-4 py-2 text-sm font-semibold text-coral-dark"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={clearing}
                  className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm disabled:opacity-60"
                >
                  {clearing ? '…' : 'Tout vider'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Plus de CSS @media print : on a abandonne l approche surcharger
          le DOM existant (trop fragile avec portal + flex + overflow).
          On utilise handlePrint qui ouvre une nouvelle fenetre HTML
          minimaliste -> pagination native parfaite, vue propre. */}
    </div>,
    document.body,
  );
}

/**
 * Ligne d'un item de la liste avec :
 *   - input quantity éditable (commit on blur ou Enter) si qty != null
 *   - input label éditable (commit on blur ou Enter)
 *   - corbeille avec confirm inline
 *
 * Raye le label quand qty=0 (visuel : article consommé / à zéro).
 * Pas de checkbox (la fonctionnalité de cochage est sur la page courses,
 * pas dans l'overlay rapide).
 */
function EditableItemRow({
  item,
  onSetQty,
  onSetLabel,
  onDelete,
}: {
  item: ShoppingListV2Item;
  onSetQty: (q: number | null) => void;
  onSetLabel: (label: string) => void;
  onDelete: () => void;
}) {
  const [qtyDraft, setQtyDraft] = useState<string>(
    item.totalQuantity == null
      ? ''
      : String(Math.round(item.totalQuantity * 100) / 100),
  );
  const [labelDraft, setLabelDraft] = useState<string>(item.label);
  const [confirmDel, setConfirmDel] = useState(false);

  // Sync local quand l'item change côté server (après refresh).
  useEffect(() => {
    setQtyDraft(
      item.totalQuantity == null
        ? ''
        : String(Math.round(item.totalQuantity * 100) / 100),
    );
  }, [item.totalQuantity]);
  useEffect(() => {
    setLabelDraft(item.label);
  }, [item.label]);

  function commitQty() {
    const parsed = qtyDraft.trim() === '' ? null : Number(qtyDraft);
    const current = item.totalQuantity;
    if (parsed === current) return;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setQtyDraft(current == null ? '' : String(current));
      return;
    }
    onSetQty(parsed);
  }
  function commitLabel() {
    const trimmed = labelDraft.trim();
    if (!trimmed) {
      setLabelDraft(item.label);
      return;
    }
    if (trimmed === item.label) return;
    onSetLabel(trimmed);
  }

  // Rayé si l'item est à 0 (épuisé / ignoré) ou coché
  const struck = item.checked || item.totalQuantity === 0;

  return (
    <li className="flex items-center gap-2 py-1.5">
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
          aria-label="Quantité"
          className="h-7 w-14 shrink-0 rounded-md border border-cream bg-white px-1.5 text-center text-xs focus:border-coral focus:outline-none"
        />
      ) : (
        <span aria-hidden className="w-14 shrink-0" />
      )}
      <div className="flex flex-1 flex-col">
        <input
          type="text"
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-label="Nom de l'article"
          className={`w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-ink transition focus:border-cream focus:bg-white focus:outline-none ${
            struck ? 'text-ink-soft line-through opacity-60' : ''
          }`}
        />
        {item.note && (
          <span className="px-1.5 text-xs italic text-ink-soft">{item.note}</span>
        )}
      </div>
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

/** Mini-form pour ajouter un ingrédient. Le bouton qui l'ouvre vit
 *  dans le footer ; ce composant rend juste le form lui-même. */
function AddIngredientForm({
  defaultCategory,
  onAdd,
  onCancel,
}: {
  defaultCategory: string;
  onAdd: (payload: {
    label: string;
    category: string;
    quantity: number | null;
    unit: string | null;
  }) => Promise<void> | void;
  onCancel: () => void;
}) {
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-coral-soft/60 bg-white p-3 shadow-sm">
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
          onClick={onCancel}
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

/**
 * Génère le HTML d'impression de la liste : 1 section par catégorie,
 * chaque ligne = quantité (+ unité) + label. Rien d'autre (pas de
 * poubelle, pas de checkbox, pas de bouton).
 */
function renderListHtml(list: ShoppingListV2): string {
  const map = new Map<string, ShoppingListV2Item[]>();
  for (const it of list.items) {
    if (!map.has(it.category)) map.set(it.category, []);
    map.get(it.category)!.push(it);
  }
  if (map.size === 0) {
    return '<p style="text-align:center;font-style:italic;color:#9ca3af;">Liste vide</p>';
  }
  const parts: string[] = [];
  for (const [cat, items] of map) {
    parts.push(`<section><h2>${escapeHtml(cat)}</h2><ul>`);
    for (const it of items) {
      const qty = it.totalQuantity;
      const qtyStr =
        qty == null
          ? '<span class="qty empty">—</span>'
          : `<span class="qty">${formatQty(qty)}${
              it.unit ? ` ${escapeHtml(it.unit)}` : ''
            }</span>`;
      const noteHtml = it.note
        ? `<span class="note">${escapeHtml(it.note)}</span>`
        : '';
      parts.push(
        `<li>${qtyStr}<span class="label">${escapeHtml(
          it.label,
        )}${noteHtml}</span></li>`,
      );
    }
    parts.push('</ul></section>');
  }
  return parts.join('');
}

function formatQty(n: number): string {
  if (n < 10) return String(Math.round(n * 2) / 2);
  return String(Math.round(n));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
