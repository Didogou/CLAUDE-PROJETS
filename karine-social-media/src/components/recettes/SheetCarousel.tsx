'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Flame, Users } from 'lucide-react';
import type { RecipeSheet, RecipeIngredient } from '@/data/recipes';
import { AddSheetToListButton } from '@/components/courses/AddSheetToListButton';

type Props = {
  sheets: RecipeSheet[];
  /** Affiche le bouton "Ajouter à ma liste" si user connecté. */
  isAuthenticated: boolean;
};

/**
 * Carrousel des fiches détaillées d'une recette.
 *
 * Chaque fiche est une variante (ex: "Poivrons farcis à la viande",
 * "Poivrons farcis aux courgettes"). Affiche les infos de la fiche
 * active : cover, titre variante, calories, prep, cuisson, servings,
 * ingrédients groupés par catégorie, tags + aliments.
 *
 * Navigation : dots cliquables + flèches gauche/droite si >= 2 fiches.
 */
export function SheetCarousel({ sheets, isAuthenticated }: Props) {
  const [active, setActive] = useState(0);
  if (sheets.length === 0) return null;
  const sheet = sheets[active];
  const total = sheets.length;

  return (
    <section className="space-y-3 rounded-2xl bg-white/95 p-4 shadow-sm">
      {/* En-tête : badge fiche X/N + dots */}
      <header className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-coral-soft/40 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-coral-dark">
          Fiche {active + 1}/{total}
        </span>
        {total > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActive((i) => (i - 1 + total) % total)}
              aria-label="Fiche précédente"
              className="grid h-7 w-7 place-items-center rounded-full bg-cream text-coral transition hover:bg-coral-soft/40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {sheets.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Voir fiche ${i + 1}`}
                className={`h-1.5 w-1.5 rounded-full transition ${
                  i === active ? 'bg-coral w-4' : 'bg-coral-soft'
                }`}
              />
            ))}
            <button
              type="button"
              onClick={() => setActive((i) => (i + 1) % total)}
              aria-label="Fiche suivante"
              className="grid h-7 w-7 place-items-center rounded-full bg-cream text-coral transition hover:bg-coral-soft/40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </header>

      {/* Image + titre variante */}
      {sheet.coverImageUrl && (
        <img
          src={sheet.coverImageUrl}
          alt={sheet.title ?? ''}
          className="aspect-[4/3] w-full rounded-xl object-cover shadow-sm"
        />
      )}
      {sheet.title && (
        <h2 className="font-script text-2xl text-coral-dark">{sheet.title}</h2>
      )}

      {/* Stats rapides */}
      <div className="grid grid-cols-4 gap-2">
        <Stat icon={Users} label="Pers" value={sheet.servings} />
        <Stat
          icon={Flame}
          label="kcal"
          value={sheet.calories}
          suffix="/pers"
        />
        <Stat
          icon={Clock}
          label="Prep"
          value={sheet.prepTimeMin}
          suffix="min"
        />
        <Stat
          icon={Clock}
          label="Cuis"
          value={sheet.cookTimeMin}
          suffix="min"
        />
      </div>

      {/* Bouton Ajouter à ma liste — utilise sheetId */}
      {isAuthenticated && (
        <AddSheetToListButton
          sheetId={sheet.id}
          hasIngredients={sheet.ingredients.length > 0}
        />
      )}

      {/* Ingrédients groupés par catégorie */}
      {sheet.ingredients.length > 0 && (
        <IngredientsList ingredients={sheet.ingredients} />
      )}

      {/* Tags + aliments */}
      {(sheet.tags.length > 0 || sheet.aliments.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {sheet.tags.map((t) => (
            <span
              key={`tag-${t}`}
              className="rounded-full bg-coral-soft/30 px-2 py-0.5 text-[0.7rem] font-semibold text-coral-dark"
            >
              {t}
            </span>
          ))}
          {sheet.aliments.map((a) => (
            <span
              key={`al-${a}`}
              className="rounded-full bg-sage/30 px-2 py-0.5 text-[0.7rem] font-semibold text-ink"
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: typeof Users;
  label: string;
  value: number | null;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg bg-cream/40 p-2 text-center">
      <Icon className="mx-auto h-4 w-4 text-coral" />
      <p className="mt-0.5 text-base font-bold text-coral-dark">
        {value ?? '—'}
      </p>
      <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-ink-soft">
        {label}
        {suffix && ` ${suffix}`}
      </p>
    </div>
  );
}

function IngredientsList({ ingredients }: { ingredients: RecipeIngredient[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, RecipeIngredient[]>();
    for (const it of ingredients) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return [...map.entries()];
  }, [ingredients]);

  return (
    <div className="space-y-2">
      <h3 className="font-script text-lg text-coral">Ingrédients</h3>
      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
            {cat}
          </p>
          <ul className="text-sm text-ink">
            {items.map((it, idx) => (
              <li key={idx}>• {formatIngredient(it)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function formatIngredient(it: RecipeIngredient): string {
  if (it.quantity == null) return capitalize(it.label);
  if (it.unit) {
    if (/^(boule|sachet|tranche|gousse)/i.test(it.unit)) {
      return `${it.quantity} ${it.unit}${it.quantity > 1 ? 's' : ''} de ${it.label}`;
    }
    return `${it.quantity} ${it.unit} de ${it.label}`;
  }
  return `${it.quantity} ${it.label}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
