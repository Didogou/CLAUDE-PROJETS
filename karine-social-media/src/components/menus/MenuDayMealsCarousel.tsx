'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Image as ImageIcon,
  Lock,
  ShoppingCart,
  Users,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import type { MenuMealSheet } from '@/data/menus';
import { DAYS_LABELS, formatWeekTitle } from '@/data/menus';
import { AddCaloriesButton } from '@/components/nutrition/AddCaloriesButton';

type Props = {
  menuId: string;
  menuTitle: string | null;
  weekStart: string;
  defaultDayIndex: number;
  mealSheetsByDay: Record<
    number,
    { lunch: MenuMealSheet | null; dinner: MenuMealSheet | null }
  >;
  shoppingListImageUrl: string;
  shoppingListItemsCount: number;
  isSubscriber: boolean;
  isAuthenticated: boolean;
};

/**
 * Carousel des fiches recettes (lunch + dinner) du jour courant d'un
 * menu hebdomadaire.
 *
 * UX :
 *  - Navigation jour-par-jour via chevrons gauche/droite (cyclique).
 *  - 2 fiches affichées en flux (lunch puis dinner) chacune avec
 *    image, titre, stats (servings/kcal/prep/cuis), ingrédients,
 *    bouton "+ Mes courses" individuel.
 *  - Bouton "Ajouter tout à mes courses" en haut → toggleMenu API.
 *  - Bouton "Voir liste d'ingrédients" → lightbox sur l'image
 *    originale (plus de tuile permanente sur la home, demande
 *    Didier 2026-06-04).
 *
 * Accès :
 *  - Abonné : tout le carousel + boutons d'action.
 *  - Visiteur : message d'incitation à s'abonner pour voir les
 *    recettes détaillées.
 */
export function MenuDayMealsCarousel({
  menuId,
  menuTitle,
  weekStart,
  defaultDayIndex,
  mealSheetsByDay,
  shoppingListImageUrl,
  shoppingListItemsCount,
  isSubscriber,
  isAuthenticated,
}: Props) {
  const [dayIndex, setDayIndex] = useState(defaultDayIndex);
  const [globalListOpen, setGlobalListOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const day = mealSheetsByDay[dayIndex] ?? { lunch: null, dinner: null };
  const meals = useMemo(
    () => [
      { kind: 'lunch' as const, label: 'Déjeuner', sheet: day.lunch },
      { kind: 'dinner' as const, label: 'Dîner', sheet: day.dinner },
    ],
    [day.lunch, day.dinner],
  );

  function nav(direction: -1 | 1) {
    setDayIndex((i) => (i + direction + 7) % 7);
  }

  async function addAllToList() {
    if (!isAuthenticated) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch('/api/shopping-list/toggle-menu', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ menuId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      setToast('Liste de courses du menu ajoutée ! 🛒');
      window.dispatchEvent(new CustomEvent('shopping-list-updated'));
      window.setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Erreur');
      window.setTimeout(() => setToast(null), 2500);
    } finally {
      setBusy(false);
    }
  }

  // === Visiteur non abonné ===
  if (!isSubscriber) {
    return (
      <section className="rounded-2xl bg-white/85 p-6 text-center shadow-sm backdrop-blur-sm">
        <Lock className="mx-auto h-8 w-8 text-coral" />
        <h2 className="mt-2 font-script text-2xl text-coral">
          Réservé aux abonnées
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Découvre les fiches recettes complètes du menu (déjeuner +
          dîner pour chaque jour) avec ingrédients et liste de courses
          interactive.
        </p>
        <Link
          href="/mon-plan"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-coral-dark"
        >
          S&apos;abonner
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {/* Actions globales du menu : ajouter tout + voir liste */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={addAllToList}
          disabled={busy || shoppingListItemsCount === 0}
          className="flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
        >
          <ShoppingCart className="h-4 w-4" />
          Ajouter tout à mes courses ({shoppingListItemsCount})
        </button>
        {shoppingListImageUrl && (
          <button
            type="button"
            onClick={() => setGlobalListOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-semibold text-coral-dark shadow-sm ring-1 ring-coral-soft/40 transition hover:bg-coral-soft/30"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Voir la liste
          </button>
        )}
      </div>

      {toast && (
        <div className="rounded-full bg-coral-soft/40 px-3 py-1.5 text-center text-xs font-semibold text-coral-dark">
          {toast}
        </div>
      )}

      {/* Navigation jour */}
      <div className="flex items-center justify-between gap-2 rounded-full bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur-sm">
        <button
          type="button"
          onClick={() => nav(-1)}
          aria-label="Jour précédent"
          className="grid h-8 w-8 place-items-center rounded-full bg-coral-soft/40 text-coral transition hover:scale-110 hover:bg-coral-soft"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
            {DAYS_LABELS[dayIndex]}
          </p>
          <p className="text-[0.7rem] text-ink-soft">
            {menuTitle || formatWeekTitle(weekStart)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => nav(1)}
          aria-label="Jour suivant"
          className="grid h-8 w-8 place-items-center rounded-full bg-coral-soft/40 text-coral transition hover:scale-110 hover:bg-coral-soft"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 2 fiches du jour (lunch + dinner) */}
      <div className="space-y-3">
        {meals.map(({ kind, label, sheet }) => (
          <MealCard
            key={kind}
            label={label}
            sheet={sheet}
            isAuthenticated={isAuthenticated}
          />
        ))}
      </div>

      {/* Lightbox liste de courses globale */}
      {globalListOpen && shoppingListImageUrl && (
        <ShoppingListImageLightbox
          imageUrl={shoppingListImageUrl}
          onClose={() => setGlobalListOpen(false)}
        />
      )}
    </section>
  );
}

// ============================================================
// MealCard : une fiche repas (lunch ou dinner)
// ============================================================

function MealCard({
  label,
  sheet,
  isAuthenticated,
}: {
  label: string;
  sheet: MenuMealSheet | null;
  isAuthenticated: boolean;
}) {
  if (!sheet) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-coral-soft/40 bg-white/40 px-4 py-6 text-center">
        <p className="text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
          {label}
        </p>
        <p className="mt-1 text-xs italic text-ink-soft">
          Pas encore de fiche pour ce repas.
        </p>
      </div>
    );
  }

  return (
    <article className="overflow-hidden rounded-2xl bg-white/85 shadow-sm backdrop-blur-sm">
      <header className="flex items-center justify-between gap-2 border-b border-cream px-3 py-1.5">
        <span className="rounded-full bg-coral-soft/40 px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
          {label}
        </span>
        {isAuthenticated && (
          <div className="flex items-center gap-1.5">
            <AddCaloriesButton
              source="menu"
              sourceRefId={sheet.id}
              label={sheet.title || `${label} (menu)`}
              kcal={sheet.calories}
              compact
            />
            <AddMealSheetButton
              sheetId={sheet.id}
              hasIngredients={sheet.ingredients.length > 0}
            />
          </div>
        )}
      </header>

      {sheet.coverImageUrl && (
        <img
          src={sheet.coverImageUrl}
          alt={sheet.title ?? ''}
          className="aspect-[4/3] w-full object-cover"
        />
      )}

      <div className="space-y-2 p-3">
        {sheet.title && (
          <h3 className="font-script text-xl text-coral-dark">
            {sheet.title}
          </h3>
        )}

        <div className="grid grid-cols-4 gap-1.5">
          <Stat icon={Users} label="Pers" value={sheet.servings} />
          <Stat icon={Flame} label="kcal" value={sheet.calories} />
          <Stat icon={Clock} label="Prep" value={sheet.prepTimeMin} suffix="min" />
          <Stat icon={Clock} label="Cuis" value={sheet.cookTimeMin} suffix="min" />
        </div>

        {sheet.ingredients.length > 0 && (
          <details className="rounded-lg bg-cream/40 px-2.5 py-1.5">
            <summary className="cursor-pointer text-xs font-semibold text-coral-dark">
              Ingrédients ({sheet.ingredients.length})
            </summary>
            <ul className="mt-1 space-y-0.5 text-[0.75rem] text-ink">
              {sheet.ingredients.map((ing, idx) => (
                <li key={idx}>
                  • {ing.quantity ?? ''}
                  {ing.unit ? ` ${ing.unit}` : ''} {ing.label}
                </li>
              ))}
            </ul>
          </details>
        )}

        {(sheet.tags.length > 0 || sheet.aliments.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {sheet.tags.map((t) => (
              <span
                key={`t-${t}`}
                className="rounded-full bg-coral-soft/30 px-2 py-0.5 text-[0.65rem] font-semibold text-coral-dark"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

// ============================================================
// Bouton + Mes courses (utilise l'API toggle-sheet — la même que pour
// recipe_sheets — mais pour une menu_meal_sheet : il faut un endpoint
// dédié vu la table source différente).
// ============================================================

function AddMealSheetButton({
  sheetId,
  hasIngredients,
}: {
  sheetId: string;
  hasIngredients: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  async function add() {
    if (busy || !hasIngredients) return;
    setBusy(true);
    try {
      const res = await fetch('/api/shopping-list/toggle-meal-sheet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mealSheetId: sheetId }),
      });
      if (!res.ok) throw new Error();
      setAdded(true);
      window.dispatchEvent(new CustomEvent('shopping-list-updated'));
      window.setTimeout(() => setAdded(false), 2000);
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={busy || !hasIngredients}
      className="flex items-center gap-1 rounded-full bg-coral px-2.5 py-1 text-[0.65rem] font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-40"
    >
      <ShoppingCart className="h-3 w-3" />
      {added ? '✓ ajouté' : 'Mes courses'}
    </button>
  );
}

// ============================================================
// Stat compact
// ============================================================

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
    <div className="rounded-lg bg-cream/30 p-1 text-center">
      <Icon className="mx-auto h-3 w-3 text-coral" />
      <p className="mt-0.5 text-xs font-bold text-coral-dark">{value ?? '—'}</p>
      <p className="text-[0.5rem] font-semibold uppercase tracking-wider text-ink-soft">
        {label}
        {suffix && ` ${suffix}`}
      </p>
    </div>
  );
}

// ============================================================
// Lightbox liste globale (image originale du menu)
// ============================================================

function ShoppingListImageLightbox({
  imageUrl,
  onClose,
}: {
  imageUrl: string;
  onClose: () => void;
}) {
  if (typeof window === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white text-ink shadow-lg ring-2 ring-white/30"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={imageUrl}
        alt="Liste de courses du menu"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-full rounded-2xl shadow-2xl"
      />
    </div>,
    document.body,
  );
}
