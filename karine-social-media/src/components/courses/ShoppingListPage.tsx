'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  Pencil,
  Plus,
  Printer,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ShoppingListV2,
  ShoppingListV2Item,
} from '@/data/shopping-lists';
import type { WeeklyMenu } from '@/data/menus';
import { formatWeekTitle } from '@/data/menus';

type Props = {
  initialList: ShoppingListV2;
  currentMenu: WeeklyMenu | null;
};

/**
 * Cœur de la page /courses : affiche la liste active, gère cochage,
 * ajout/suppression article, archivage et toggle du menu hebdo.
 */
export function ShoppingListPage({ initialList, currentMenu }: Props) {
  const [list, setList] = useState(initialList);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialList.name);
  const [addingItem, setAddingItem] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const menuLinked = currentMenu !== null && list.linkedMenuId === currentMenu.id;
  const checkedCount = list.items.filter((it) => it.checked).length;
  const totalCount = list.items.length;
  const progress = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;

  // Groupage par catégorie dans l'ordre d'apparition
  const categories = useMemo(() => {
    const map = new Map<string, ShoppingListV2Item[]>();
    for (const it of list.items) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return [...map.entries()];
  }, [list.items]);

  async function call(input: RequestInfo, init?: RequestInit) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(input, init);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur réseau');
      if (j.list) setList(j.list);
      return j;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function toggleItem(itemKey: string) {
    await call(`/api/shopping-list/items/${encodeURIComponent(itemKey)}`, {
      method: 'PATCH',
    });
  }

  async function deleteItem(itemKey: string) {
    await call(`/api/shopping-list/items/${encodeURIComponent(itemKey)}`, {
      method: 'DELETE',
    });
  }

  async function toggleMenuLinked() {
    if (!currentMenu) return;
    await call('/api/shopping-list/toggle-menu', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ menuId: currentMenu.id }),
    });
  }

  async function removeRecipe(recipeId: string) {
    await call('/api/shopping-list/toggle-recipe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipeId }),
    });
  }

  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === list.name) {
      setRenaming(false);
      setNameDraft(list.name);
      return;
    }
    await call('/api/shopping-list', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    setRenaming(false);
  }

  async function archiveList() {
    await call('/api/shopping-list/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    setConfirmingArchive(false);
  }

  return (
    <div className="space-y-4">
      {/* Erreur globale */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Nom de la liste éditable */}
      <section className="rounded-2xl bg-white/95 p-4 shadow-sm">
        {renaming ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName();
                else if (e.key === 'Escape') {
                  setRenaming(false);
                  setNameDraft(list.name);
                }
              }}
              className="input flex-1"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={busy}
              className="rounded-full bg-coral px-3 py-1.5 text-xs font-bold text-white"
            >
              OK
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-script text-2xl text-coral-dark">{list.name}</h2>
            <button
              type="button"
              onClick={() => setRenaming(true)}
              aria-label="Renommer la liste"
              className="rounded-full p-1.5 text-ink-soft transition hover:bg-coral-soft/30 hover:text-coral"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="mt-2 flex items-center gap-3">
          <span className="rounded-full bg-coral-soft/40 px-2.5 py-0.5 text-xs font-bold text-coral-dark">
            {checkedCount}/{totalCount} cochés
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-cream">
            <div
              className="h-full rounded-full bg-coral transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </section>

      {/* Menu de la semaine — cover + toggle ajout */}
      {currentMenu && currentMenu.coverImageUrl && (
        <section className="overflow-hidden rounded-2xl bg-white/95 shadow-sm">
          <Link
            href={`/menus/${currentMenu.id}/jour`}
            className="block"
            aria-label="Voir le menu de la semaine"
          >
            <img
              src={currentMenu.coverImageUrl}
              alt={currentMenu.title || 'Menu de la semaine'}
              className="aspect-[3/2] w-full object-cover"
            />
          </Link>
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold uppercase tracking-wider text-coral-dark">
                Menu de la semaine
              </p>
              <p className="truncate text-sm text-ink">
                {currentMenu.title || formatWeekTitle(currentMenu.weekStart)}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleMenuLinked}
              disabled={busy || (currentMenu.shoppingListItems ?? []).length === 0}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                menuLinked
                  ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300'
                  : 'bg-coral text-white shadow-sm hover:bg-coral-dark'
              }`}
            >
              {menuLinked ? '✓ Ajouté' : 'Ajouter à ma liste'}
            </button>
          </div>
          {(currentMenu.shoppingListItems ?? []).length === 0 && (
            <p className="border-t border-cream px-3 py-2 text-[0.65rem] italic text-ink-soft">
              La liste interactive de ce menu n&apos;est pas encore disponible.
            </p>
          )}
        </section>
      )}

      {/* Recettes ajoutées */}
      {list.linkedRecipes.length > 0 && (
        <section className="rounded-2xl bg-white/95 p-3 shadow-sm">
          <h2 className="mb-2 font-script text-xl text-coral">Recettes ajoutées</h2>
          <ul className="flex gap-3 overflow-x-auto pb-1">
            {list.linkedRecipes.map((r) => (
              <li key={r.recipeId} className="relative shrink-0 w-24">
                <Link
                  href={`/recettes/${r.recipeId}`}
                  className="block overflow-hidden rounded-xl bg-blush/30 shadow-sm"
                >
                  <div
                    className="aspect-square w-full bg-cover bg-center"
                    style={
                      r.recipeCoverUrl
                        ? { backgroundImage: `url(${r.recipeCoverUrl})` }
                        : undefined
                    }
                  />
                  <p className="line-clamp-2 px-1.5 py-1 text-center text-[0.7rem] font-semibold text-ink">
                    {r.recipeTitle}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => removeRecipe(r.recipeId)}
                  disabled={busy}
                  aria-label="Retirer cette recette"
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/95 text-coral shadow ring-1 ring-coral-soft/40 transition hover:scale-110"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Items groupés par catégorie */}
      {categories.length === 0 ? (
        <section className="rounded-2xl border-2 border-dashed border-coral-soft/60 bg-white/40 px-4 py-8 text-center">
          <p className="text-sm text-ink-soft">
            Ta liste est vide. Ajoute une recette ou le menu de la semaine !
          </p>
        </section>
      ) : (
        <div className="space-y-3">
          {categories.map(([cat, items]) => (
            <section
              key={cat}
              className="rounded-2xl bg-white/95 p-3 shadow-sm ring-1 ring-cream"
            >
              <h2 className="mb-2 font-script text-xl text-coral">{cat}</h2>
              <ul className="divide-y divide-cream">
                {items.map((it) => (
                  <ItemRow
                    key={it.key}
                    item={it}
                    onToggle={() => toggleItem(it.key)}
                    onDelete={() => deleteItem(it.key)}
                    busy={busy}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Ajouter un article manuel */}
      {addingItem ? (
        <AddItemForm
          onCancel={() => setAddingItem(false)}
          onAdded={(newList) => {
            setList(newList);
            setAddingItem(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddingItem(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-coral-soft/60 bg-white/40 px-4 py-3 text-sm font-semibold text-coral-dark transition hover:bg-white/60"
        >
          <Plus className="h-4 w-4" /> Ajouter un article
        </button>
      )}

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-ink-soft shadow-sm transition hover:bg-white"
        >
          <Printer className="h-3 w-3" /> Imprimer
        </button>
        {confirmingArchive ? (
          <div className="flex items-center gap-2 rounded-full bg-coral-soft/30 p-1 pl-3">
            <span className="text-xs font-semibold text-coral-dark">
              Archiver et démarrer une nouvelle liste ?
            </span>
            <button
              type="button"
              onClick={() => setConfirmingArchive(false)}
              disabled={busy}
              className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-soft"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={archiveList}
              disabled={busy}
              className="rounded-full bg-coral px-3 py-1 text-xs font-bold text-white shadow-sm"
            >
              Confirmer
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingArchive(true)}
            disabled={busy || totalCount === 0}
            className="flex items-center gap-1 rounded-full bg-coral px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
          >
            <Save className="h-3 w-3" /> Sauvegarder cette liste
          </button>
        )}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onToggle,
  onDelete,
  busy,
}: {
  item: ShoppingListV2Item;
  onToggle: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const formatted = formatItem(item);
  return (
    <li className="flex items-start gap-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={item.checked ? 'Décocher' : 'Cocher'}
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition ${
          item.checked
            ? 'border-coral bg-coral text-white'
            : 'border-coral-soft bg-white'
        }`}
      >
        {item.checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </button>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={`flex-1 text-left transition ${item.checked ? 'opacity-50' : ''}`}
      >
        <span
          className={`block text-sm font-semibold text-ink ${
            item.checked ? 'line-through' : ''
          }`}
        >
          {formatted}
        </span>
        {item.note && (
          <span className="block text-xs italic text-ink-soft">{item.note}</span>
        )}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label="Supprimer cet article"
        className="grid h-7 w-7 place-items-center rounded-full text-ink-soft transition hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function AddItemForm({
  onAdded,
  onCancel,
}: {
  onAdded: (newList: ShoppingListV2) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('Divers');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!label.trim()) {
      setError('Nom requis');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/shopping-list/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          category: category.trim() || 'Divers',
          quantity: quantity.trim() ? Number(quantity) : null,
          unit: unit.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      onAdded(j.list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white/95 p-3 shadow-sm ring-1 ring-coral-soft/50">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-script text-lg text-coral">Nouvel article</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Annuler"
          className="grid h-7 w-7 place-items-center rounded-full text-ink-soft hover:bg-cream"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="grid gap-2 sm:grid-cols-[4rem_4rem_1fr]">
        <input
          type="number"
          step="0.5"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Qté"
          className="input h-9 text-center text-sm"
        />
        <input
          type="text"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="g/cl"
          className="input h-9 text-center text-sm"
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nom de l'article"
          className="input h-9 text-sm"
          autoFocus
        />
      </div>
      <input
        type="text"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="Catégorie (ex: Épicerie)"
        className="input mt-2 h-9 text-sm"
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-full border border-coral-soft bg-white px-3 py-1.5 text-xs font-semibold text-coral-dark"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-full bg-coral px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
        >
          {busy ? '…' : 'Ajouter'}
        </button>
      </div>
    </section>
  );
}

/** Formatte un item : "250 g de feta", "3 courgettes", "Huile d'olive". */
function formatItem(item: ShoppingListV2Item): string {
  const qty = item.totalQuantity;
  if (qty === null) return capitalize(item.label);
  const rounded = roundSensible(qty);
  if (item.unit) {
    if (/^(boule|sachet|tranche|gousse|yaourt)/i.test(item.unit)) {
      return `${rounded} ${item.unit}${rounded > 1 ? 's' : ''} de ${item.label}`;
    }
    return `${rounded} ${item.unit} de ${item.label}`;
  }
  return `${rounded} ${item.label}`;
}

function roundSensible(n: number): number {
  if (n < 1) return Math.round(n * 4) / 4;
  if (n < 10) return Math.round(n * 2) / 2;
  if (n < 100) return Math.round(n);
  return Math.round(n / 5) * 5;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

