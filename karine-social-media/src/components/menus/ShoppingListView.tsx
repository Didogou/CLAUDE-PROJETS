'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Eraser,
  Image as ImageIcon,
  Minus,
  Plus,
  Printer,
  Users,
} from 'lucide-react';
import type { ShoppingListItem } from '@/data/menus';

type Props = {
  menuId: string;
  items: ShoppingListItem[];
  basePortions: number;
  imageUrl: string | null;
};

/**
 * Vue cochable de la liste de courses pour le user.
 *
 *  - Cochage persisté en localStorage (key par menuId, set d'IDs stables).
 *  - Selector "nombre de personnes" → multiplie les quantités à l'affichage
 *    (la liste DB reste calibrée sur basePortions, l'utilisateur ajuste juste
 *    à son foyer).
 *  - Vue image source en option (toggle "Voir l'image originale").
 *
 * ID des items : hash léger sur category+label. Stable tant que Karine ne
 * renomme pas un ingrédient. Acceptable pour V1 puisque le cochage est
 * éphémère (1 semaine).
 */
export function ShoppingListView({ menuId, items, basePortions, imageUrl }: Props) {
  const [portions, setPortions] = useState(basePortions);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showImage, setShowImage] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const storageKey = `karine-shopping-${menuId}`;

  // Hydratation : on lit le cochage localStorage UNIQUEMENT côté client,
  // pour ne pas casser l'hydration SSR (rendu serveur = vide).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) setChecked(new Set(arr));
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [storageKey]);

  // Persistance : sauvegarde à chaque changement après hydratation.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...checked]));
    } catch {
      /* localStorage plein → ignore */
    }
  }, [checked, hydrated, storageKey]);

  function toggleItem(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearAll() {
    setChecked(new Set());
  }

  // Groupage par catégorie dans l'ordre d'apparition
  const grouped = useMemo(() => {
    const map = new Map<string, Array<{ item: ShoppingListItem; id: string }>>();
    for (const item of items) {
      const id = itemId(item);
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push({ item, id });
    }
    return [...map.entries()];
  }, [items]);

  const ratio = portions / basePortions;
  const totalCount = items.length;
  const checkedCount = items.filter((it) => checked.has(itemId(it))).length;
  const progressPct = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Barre de contrôle : nb personnes + actions */}
      <div className="sticky top-3 z-10 rounded-2xl bg-white/95 p-3 shadow-md ring-1 ring-coral-soft/40 backdrop-blur print:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-coral" />
            <span className="text-sm font-semibold text-ink">Pour</span>
            <PortionsStepper value={portions} onChange={setPortions} />
            <span className="text-sm font-semibold text-ink">
              {portions > 1 ? 'personnes' : 'personne'}
            </span>
          </div>
          <span className="rounded-full bg-coral-soft/40 px-2.5 py-0.5 text-xs font-bold text-coral-dark">
            {checkedCount}/{totalCount}
          </span>
        </div>

        {/* Barre de progression */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-cream">
          <div
            className="h-full rounded-full bg-coral transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {portions !== basePortions && (
          <p className="mt-2 text-[0.7rem] italic text-ink-soft">
            Quantités ajustées : recette initialement pour {basePortions} personnes.
          </p>
        )}

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={clearAll}
            disabled={checkedCount === 0}
            className="flex items-center gap-1 rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-ink-soft transition hover:bg-coral-soft/30 disabled:opacity-40"
          >
            <Eraser className="h-3 w-3" /> Tout décocher
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1 rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-ink-soft transition hover:bg-coral-soft/30"
          >
            <Printer className="h-3 w-3" /> Imprimer
          </button>
          {imageUrl && (
            <button
              type="button"
              onClick={() => setShowImage((v) => !v)}
              className="flex items-center gap-1 rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-ink-soft transition hover:bg-coral-soft/30"
            >
              <ImageIcon className="h-3 w-3" />
              {showImage ? 'Masquer image' : "Voir l'image originale"}
            </button>
          )}
        </div>
      </div>

      {/* Image originale (toggle) */}
      {imageUrl && showImage && (
        <img
          src={imageUrl}
          alt="Liste de courses originale"
          className="w-full rounded-2xl shadow-md print:hidden"
        />
      )}

      {/* Catégories + items */}
      <div className="space-y-3">
        {grouped.map(([category, rows]) => (
          <section
            key={category}
            className="rounded-2xl bg-white/95 p-3 shadow-sm ring-1 ring-cream"
          >
            <h2 className="mb-2 font-script text-xl text-coral">{category}</h2>
            <ul className="divide-y divide-cream">
              {rows.map(({ item, id }) => {
                const isChecked = checked.has(id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => toggleItem(id)}
                      className={`flex w-full items-start gap-3 py-2.5 text-left transition ${
                        isChecked ? 'opacity-50' : ''
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition ${
                          isChecked
                            ? 'border-coral bg-coral text-white'
                            : 'border-coral-soft bg-white'
                        }`}
                      >
                        {isChecked && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      <span className="flex-1">
                        <span
                          className={`text-sm font-semibold text-ink ${
                            isChecked ? 'line-through' : ''
                          }`}
                        >
                          {formatItem(item, ratio)}
                        </span>
                        {item.note && (
                          <span className="block text-xs italic text-ink-soft">
                            {item.note}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* Mention bas de page */}
      <p className="pt-2 text-center text-xs italic text-ink-soft print:text-[0.65rem]">
        Pense à vérifier tes stocks à la maison avant de partir faire tes courses !
      </p>
    </div>
  );
}

function PortionsStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-cream px-1 py-0.5">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        aria-label="Moins"
        className="grid h-6 w-6 place-items-center rounded-full text-coral transition hover:bg-coral-soft/40 disabled:opacity-30"
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="min-w-[1.25rem] text-center text-sm font-bold text-coral-dark">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(20, value + 1))}
        disabled={value >= 20}
        aria-label="Plus"
        className="grid h-6 w-6 place-items-center rounded-full text-coral transition hover:bg-coral-soft/40 disabled:opacity-30"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

/** ID stable pour le cochage localStorage. */
function itemId(item: ShoppingListItem): string {
  return `${item.category}|${item.label}`.toLowerCase();
}

/**
 * Formatte un item : "250 g de tomates cerises", "3 courgettes",
 * "Sel, poivre". Multiplie la quantité par `ratio` (portions
 * utilisateur / portions baseline) et arrondit raisonnablement.
 */
function formatItem(item: ShoppingListItem, ratio: number): string {
  const { quantity, unit, label } = item;
  if (quantity == null) return capitalize(label);

  const scaled = quantity * ratio;
  const qty = roundSensible(scaled);

  // Avec unité : "250 g de tomates cerises" / "1 boule de mozzarella"
  if (unit) {
    // Cas particulier "boule" / "sachet" / etc. : "1 boule de mozzarella"
    if (/^(boule|sachet|tranche|gousse|yaourt|sachets?|boules?)/i.test(unit)) {
      return `${qty} ${unit}${qty > 1 ? 's' : ''} de ${label}`;
    }
    return `${qty} ${unit} de ${label}`;
  }
  // Sans unité : "3 courgettes" / "1 avocat"
  return `${qty} ${label}`;
}

/**
 * Arrondi raisonnable selon l'ordre de grandeur :
 *  - < 1     : 2 décimales (0.5, 0.25)
 *  - < 10    : 1 décimale (3.5, 7.5)
 *  - < 100   : entier (12, 75)
 *  - ≥ 100   : multiples de 5 (105, 250)
 */
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
