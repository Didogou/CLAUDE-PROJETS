'use client';

import type { RecipeIngredient } from '@/data/recipes';
import {
  isGlutenFreeAuto,
  isPorkFreeAuto,
  isVegetarianAuto,
} from '@/lib/dietary-tags';

/**
 * Toggle override d'un tag diététique (Auto / Oui forcé / Non forcé).
 * Partagé entre l'éditeur de fiche recette (RecipeSheetsEditor) et de
 * fiche repas de menu (MealSheetEditor) — même principe.
 *
 * value = null → auto-détection depuis les ingrédients ; true/false →
 * Karine force la valeur.
 */
export function DietaryToggle({
  label,
  ingredientList,
  kind,
  value,
  onChange,
}: {
  label: string;
  ingredientList: RecipeIngredient[];
  kind: 'vegetarian' | 'glutenFree' | 'porkFree';
  value: boolean | null | undefined;
  onChange: (v: boolean | null) => void;
}) {
  const normalized: boolean | null = value === undefined ? null : value;
  const autoResult =
    kind === 'vegetarian'
      ? isVegetarianAuto(ingredientList)
      : kind === 'glutenFree'
        ? isGlutenFreeAuto(ingredientList)
        : isPorkFreeAuto(ingredientList);
  const effective = normalized === null ? autoResult : normalized;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-admin-soft/40 px-2.5 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="text-xs font-bold text-admin-ink">{label}</span>
        <span
          className={`text-[0.6rem] font-semibold uppercase tracking-wider ${
            effective ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          {effective ? 'OUI' : 'non'}
        </span>
        <span
          className="text-[0.55rem] italic text-admin-ink-soft"
          title="Résultat de l'auto-détection sur les ingrédients"
        >
          (auto : {autoResult ? 'oui' : 'non'})
        </span>
      </div>
      <div className="flex gap-0.5 rounded-full bg-white p-0.5 ring-1 ring-admin-border">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider transition ${
            normalized === null
              ? 'bg-admin-primary text-white'
              : 'text-admin-ink-soft hover:bg-admin-soft'
          }`}
          title="Utiliser l'auto-détection"
        >
          Auto
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider transition ${
            normalized === true
              ? 'bg-emerald-600 text-white'
              : 'text-admin-ink-soft hover:bg-admin-soft'
          }`}
          title="Forcer le tag à OUI"
        >
          Oui
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider transition ${
            normalized === false
              ? 'bg-rose-600 text-white'
              : 'text-admin-ink-soft hover:bg-admin-soft'
          }`}
          title="Forcer le tag à non"
        >
          Non
        </button>
      </div>
    </div>
  );
}
