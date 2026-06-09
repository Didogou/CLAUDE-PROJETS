'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check,
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

/** Labels jours FR courts, indexes par day_index (0=lundi → 6=dimanche). */
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

/**
 * Cœur de la page /courses : affiche la liste active, gère cochage,
 * ajout/suppression article, archivage et toggle du menu hebdo.
 */
export function ShoppingListPage({ initialList, currentMenu }: Props) {
  const [list, setList] = useState(initialList);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function removeSheet(sheetId: string) {
    await call('/api/shopping-list/toggle-sheet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sheetId }),
    });
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


      {/* Menu de la semaine — VIGNETTES REPAS uniquement si le menu
          est ajoute a la liste. Croix sur chaque vignette = retire
          le menu entier (= retire les ingredients correspondants de
          la liste de courses). */}
      {currentMenu && menuLinked && currentMenu.days.length > 0 && (
        <section className="rounded-2xl bg-white/95 p-3 shadow-sm">
          <p className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
            Repas du menu
          </p>
          <ul className="flex gap-2.5 overflow-x-auto pb-1">
            {currentMenu.days.flatMap((d) => {
              const meals: Array<{
                key: string;
                label: string;
                title: string;
                imageUrl: string | null;
                dayIndex: number;
              }> = [];
              if (d.lunchLabel || d.lunchImageUrl) {
                meals.push({
                  key: `${d.dayIndex}-lunch`,
                  label: `${DAY_LABELS[d.dayIndex]} midi`,
                  title: d.lunchLabel || '',
                  imageUrl: d.lunchImageUrl,
                  dayIndex: d.dayIndex,
                });
              }
              if (d.dinnerLabel || d.dinnerImageUrl) {
                meals.push({
                  key: `${d.dayIndex}-dinner`,
                  label: `${DAY_LABELS[d.dayIndex]} soir`,
                  title: d.dinnerLabel || '',
                  imageUrl: d.dinnerImageUrl,
                  dayIndex: d.dayIndex,
                });
              }
              return meals;
            }).map((m) => (
              <li key={m.key} className="relative shrink-0 w-20">
                {/* Croix de retrait : cliquer enleve TOUT le menu de
                    la liste (= retire tous les ingredients du menu).
                    On ne peut pas retirer un seul repas, le modele
                    backend stocke les ingredients du menu en bloc. */}
                <button
                  type="button"
                  onClick={toggleMenuLinked}
                  disabled={busy}
                  aria-label="Retirer le menu de la liste"
                  className="absolute -right-1 -top-1 z-10 grid size-5 place-items-center rounded-full bg-white text-rose-600 shadow-md ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  <X className="size-3" />
                </button>
                <Link
                  href={`/menus/${currentMenu.id}/jour?d=${m.dayIndex}`}
                  className="block overflow-hidden rounded-xl bg-blush/30 shadow-sm transition hover:scale-105 active:scale-95"
                >
                  <div
                    className="aspect-square w-full bg-cover bg-center bg-blush/40"
                    style={
                      m.imageUrl
                        ? { backgroundImage: `url(${m.imageUrl})` }
                        : undefined
                    }
                  />
                  <p className="px-1 pt-1 text-center text-[0.6rem] font-bold uppercase tracking-wider text-coral-dark">
                    {m.label}
                  </p>
                  <p className="line-clamp-2 px-1 pb-1.5 text-center text-[0.65rem] font-semibold leading-tight text-ink">
                    {m.title || '—'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Fiches détaillées ajoutées (anciennement "Recettes") */}
      {list.linkedRecipes.length > 0 && (
        <section className="rounded-2xl bg-white/95 p-3 shadow-sm">
          <h2 className="mb-2 font-script text-xl text-coral">Recettes ajoutées</h2>
          <ul className="flex gap-3 overflow-x-auto pb-1">
            {list.linkedRecipes.map((r) => (
              <li key={r.sheetId} className="relative shrink-0 w-24">
                <Link
                  href={`/recettes/${r.recipeSlug}`}
                  className="block overflow-hidden rounded-xl bg-blush/30 shadow-sm"
                >
                  <div
                    className="aspect-square w-full bg-cover bg-center"
                    style={
                      r.sheetCoverUrl
                        ? { backgroundImage: `url(${r.sheetCoverUrl})` }
                        : undefined
                    }
                  />
                  <p className="line-clamp-2 px-1.5 py-1 text-center text-[0.7rem] font-semibold text-ink">
                    {r.sheetTitle}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => removeSheet(r.sheetId)}
                  disabled={busy}
                  aria-label="Retirer cette fiche"
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

