'use client';

/* eslint-disable @next/next/no-img-element */
import { Cookie, Moon, Sun, UtensilsCrossed } from 'lucide-react';

type MealCategory = 'breakfast' | 'lunch' | 'snack' | 'dinner';

/**
 * Mapping image custom pour une catégorie de repas. Quand on a une
 * vraie illustration (PNG / SVG dans public/icons/meals/), on
 * l'utilise — sinon on retombe sur l'icône lucide générique.
 *
 * Ajouter d'autres images dans public/icons/meals/ + référencer ici.
 */
const MEAL_IMAGE: Partial<Record<MealCategory, string>> = {
  breakfast: '/icons/meals/breakfast.png',
  lunch: '/icons/meals/lunch.png',
  snack: '/icons/meals/snack.png',
  dinner: '/icons/meals/dinner.png',
};

const MEAL_BG_COLOR: Record<MealCategory, string> = {
  breakfast: '#f59e0b',
  lunch: '#e2788d',
  snack: '#a78bfa',
  dinner: '#1e3a8a',
};

/**
 * `true` si une image custom existe pour cette catégorie (donc pas
 * besoin de pastille colorée derrière).
 */
export function hasMealImage(category: MealCategory): boolean {
  return MEAL_IMAGE[category] != null;
}

const MEAL_LUCIDE: Record<MealCategory, typeof Sun> = {
  breakfast: Sun,
  lunch: UtensilsCrossed,
  snack: Cookie,
  dinner: Moon,
};

/**
 * Avatar carré-arrondi auto-géré d'une catégorie de repas.
 *
 * - Si une image custom existe → image en pleine taille SANS fond
 *   coloré (l'illustration apporte déjà son contexte visuel).
 * - Sinon → pastille avec couleur de catégorie + icône lucide
 *   centrée en taille `lucideSize`.
 *
 * `wrapperSize` contrôle la taille globale du composant (ex:
 * "size-12"). Utilise un wrapper unique côté caller, plus de span
 * coloré séparé.
 */
export function MealCategoryAvatar({
  category,
  wrapperSize = 'size-11',
  lucideSize = 'size-5',
}: {
  category: MealCategory;
  wrapperSize?: string;
  lucideSize?: string;
}) {
  const url = MEAL_IMAGE[category];
  if (url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        draggable={false}
        className={`${wrapperSize} object-contain`}
      />
    );
  }
  const Lucide = MEAL_LUCIDE[category];
  return (
    <span
      className={`grid ${wrapperSize} shrink-0 place-items-center rounded-full text-white shadow-sm`}
      style={{ backgroundColor: MEAL_BG_COLOR[category] }}
    >
      <Lucide className={lucideSize} />
    </span>
  );
}

/**
 * @deprecated Préférer MealCategoryAvatar (gère lui-même son fond).
 * Conservé temporairement le temps de migrer les usages.
 */
export function MealIcon({
  category,
  imageClassName = 'size-11',
  lucideClassName = 'size-5',
}: {
  category: MealCategory;
  imageClassName?: string;
  lucideClassName?: string;
}) {
  const url = MEAL_IMAGE[category];
  if (url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        draggable={false}
        className={`${imageClassName} object-contain`}
      />
    );
  }
  const Lucide = MEAL_LUCIDE[category];
  return <Lucide className={lucideClassName} />;
}
