'use client';

import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Check,
} from 'lucide-react';
import type { ShoppingListItem } from '@/data/menus';

type Props = {
  menuId: string;
  initialImageUrl: string | null;
  initialPortions: number | null;
  initialItems: ShoppingListItem[] | null;
};

/**
 * Éditeur dédié à la liste de courses d'un menu.
 *
 * Flow :
 *  1. Karine upload une image → POST /shopping-list/extract
 *     → l'API enregistre l'image dans Storage + appelle Claude Vision
 *     → renvoie { imageUrl, portions, items } préremplis
 *  2. Karine corrige ce qu'elle veut (portions + items éditables)
 *  3. Clic "Enregistrer la liste" → PUT /shopping-list
 *     → persiste { portions, items } en DB
 *
 * Le composant gère son propre cycle de vie (indépendant du form principal
 * de MenuForm) parce que Vision peut prendre 5-15s et qu'on veut afficher
 * un état de chargement explicite sans bloquer le reste du form.
 */
export function ShoppingListEditor({
  menuId,
  initialImageUrl,
  initialPortions,
  initialItems,
}: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl);
  const [portions, setPortions] = useState<number>(initialPortions ?? 4);
  const [items, setItems] = useState<ShoppingListItem[]>(initialItems ?? []);
  const [busy, setBusy] = useState<'idle' | 'extracting' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Catégories ordonnées dans l'ordre d'apparition (pour ne pas casser le
  // groupement visuel quand Karine ajoute un item dans une nouvelle catégorie).
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of items) {
      if (!seen.has(it.category)) {
        seen.add(it.category);
        out.push(it.category);
      }
    }
    return out;
  }, [items]);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy('extracting');
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch(
        `/api/admin/menus/${menuId}/shopping-list/extract`,
        { method: 'POST', body: fd },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Échec de l\'analyse de l\'image.');
      setImageUrl(j.imageUrl ?? null);
      setPortions(typeof j.portions === 'number' ? j.portions : 4);
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau');
    } finally {
      setBusy('idle');
      // Reset le file input pour pouvoir re-sélectionner le même fichier
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSave() {
    setError(null);
    setBusy('saving');
    try {
      const res = await fetch(`/api/admin/menus/${menuId}/shopping-list`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ portions, items }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Échec de l\'enregistrement.');
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau');
    } finally {
      setBusy('idle');
    }
  }

  function updateItem(idx: number, patch: Partial<ShoppingListItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function addItem(category: string) {
    setItems((prev) => [
      ...prev,
      { category, label: '', quantity: null, unit: null, note: null },
    ]);
  }
  function commitNewCategory() {
    const name = (newCategoryInput ?? '').trim();
    if (name) {
      setItems((prev) => [
        ...prev,
        { category: name, label: '', quantity: null, unit: null, note: null },
      ]);
    }
    setNewCategoryInput(null);
  }

  const hasContent = imageUrl !== null || items.length > 0;

  return (
    <section className="rounded-2xl border border-admin-border bg-admin-surface/40 p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-script text-2xl text-admin-primary-dark">
            🛒 Liste de courses interactive
          </h3>
          <p className="text-xs text-admin-ink-soft">
            Charge l&apos;image de la liste — Claude Vision extrait
            automatiquement les ingrédients et le nombre de personnes.
            Tu pourras corriger ce que tu veux avant d&apos;enregistrer.
          </p>
        </div>
      </header>

      {/* Zone upload / preview de l'image source */}
      <div className="mb-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <div
          className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border-2 border-dashed border-admin-border bg-admin-surface bg-cover bg-center"
          style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
        >
          {!imageUrl && (
            <div className="absolute inset-0 grid place-items-center text-admin-ink-soft">
              <div className="text-center">
                <Upload className="mx-auto h-8 w-8" />
                <p className="mt-2 text-sm font-semibold">Aucune image</p>
              </div>
            </div>
          )}
          {busy === 'extracting' && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 text-white">
              <div className="text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin" />
                <p className="mt-2 text-sm font-bold">
                  Claude Vision analyse l&apos;image…
                </p>
                <p className="text-xs opacity-80">~5 à 15 secondes</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full bg-admin-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-50">
            <Sparkles className="h-4 w-4" />
            {imageUrl ? 'Remplacer + analyser' : 'Importer + analyser'}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFile}
              disabled={busy !== 'idle'}
            />
          </label>
          {imageUrl && (
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-admin-border bg-white px-4 py-2 text-center text-xs font-semibold text-admin-ink-soft transition hover:bg-admin-soft/30"
            >
              Voir l&apos;image
            </a>
          )}
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Éditeur de la liste (visible si on a quelque chose à éditer) */}
      {hasContent && (
        <>
          <div className="mb-3 flex items-end justify-between gap-3">
            <label className="flex items-center gap-2">
              <span className="text-sm font-semibold text-admin-ink">
                Nombre de personnes :
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={portions}
                onChange={(e) =>
                  setPortions(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                }
                className="input w-20 text-center"
              />
            </label>
            <p className="text-xs text-admin-ink-soft">
              {items.length} ingrédient{items.length > 1 ? 's' : ''}
            </p>
          </div>

          <div className="space-y-3">
            {categories.map((cat) => (
              <CategoryBlock
                key={cat}
                category={cat}
                items={items}
                onUpdate={updateItem}
                onRemove={removeItem}
                onAdd={() => addItem(cat)}
              />
            ))}
            {newCategoryInput === null ? (
              <button
                type="button"
                onClick={() => setNewCategoryInput('')}
                className="w-full rounded-xl border border-dashed border-admin-border bg-admin-surface/60 py-2 text-xs font-semibold text-admin-ink-soft transition hover:bg-admin-soft/30"
              >
                + Nouvelle catégorie
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-admin-border bg-white p-2">
                <input
                  autoFocus
                  type="text"
                  value={newCategoryInput}
                  onChange={(e) => setNewCategoryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitNewCategory();
                    } else if (e.key === 'Escape') {
                      setNewCategoryInput(null);
                    }
                  }}
                  placeholder="Nom de la catégorie"
                  className="input h-8 flex-1 text-sm"
                />
                <button
                  type="button"
                  onClick={commitNewCategory}
                  className="rounded-full bg-admin-primary px-3 py-1 text-xs font-bold text-white transition hover:bg-admin-primary-dark"
                >
                  Ajouter
                </button>
                <button
                  type="button"
                  onClick={() => setNewCategoryInput(null)}
                  className="rounded-full border border-admin-border bg-white px-3 py-1 text-xs font-semibold text-admin-ink-soft transition hover:bg-admin-soft/30"
                >
                  Annuler
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-end gap-3">
            {savedFlash && (
              <span className="flex items-center gap-1 text-sm font-bold text-emerald-600">
                <Check className="h-4 w-4" /> Liste enregistrée
              </span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={busy !== 'idle' || items.length === 0}
              className="flex items-center gap-2 rounded-full bg-admin-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-50"
            >
              {busy === 'saving' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {busy === 'saving' ? 'Enregistrement…' : 'Enregistrer la liste'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function CategoryBlock({
  category,
  items,
  onUpdate,
  onRemove,
  onAdd,
}: {
  category: string;
  items: ShoppingListItem[];
  onUpdate: (idx: number, patch: Partial<ShoppingListItem>) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="rounded-xl border border-admin-border bg-white p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-admin-primary-dark">
        {category}
      </p>
      <div className="space-y-1.5">
        {items.map((it, idx) =>
          it.category === category ? (
            <ItemRow
              key={idx}
              item={it}
              onUpdate={(patch) => onUpdate(idx, patch)}
              onRemove={() => onRemove(idx)}
            />
          ) : null,
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-admin-primary-dark transition hover:bg-admin-soft/40"
      >
        <Plus className="h-3 w-3" /> Ajouter
      </button>
    </div>
  );
}

function ItemRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: ShoppingListItem;
  onUpdate: (patch: Partial<ShoppingListItem>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[3rem_3rem_1fr_auto] items-center gap-1.5 sm:grid-cols-[4rem_4rem_1fr_2fr_auto]">
      <input
        type="number"
        step="0.5"
        min="0"
        value={item.quantity ?? ''}
        onChange={(e) =>
          onUpdate({
            quantity:
              e.target.value === ''
                ? null
                : Math.max(0, Number(e.target.value) || 0),
          })
        }
        placeholder="—"
        className="input h-8 px-1.5 text-center text-sm"
      />
      <input
        type="text"
        value={item.unit ?? ''}
        onChange={(e) => onUpdate({ unit: e.target.value || null })}
        placeholder="g/cl"
        className="input h-8 px-1.5 text-center text-sm"
      />
      <input
        type="text"
        value={item.label}
        onChange={(e) => onUpdate({ label: e.target.value })}
        placeholder="ingrédient"
        className="input h-8 px-2 text-sm"
      />
      <input
        type="text"
        value={item.note ?? ''}
        onChange={(e) => onUpdate({ note: e.target.value || null })}
        placeholder="note (optionnel)"
        className="input hidden h-8 px-2 text-xs italic text-admin-ink-soft sm:block"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Supprimer cet ingrédient"
        className="grid h-8 w-8 place-items-center rounded-full text-admin-ink-soft transition hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
