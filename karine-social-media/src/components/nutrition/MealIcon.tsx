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
};

const MEAL_LUCIDE: Record<MealCategory, typeof Sun> = {
  breakfast: Sun,
  lunch: UtensilsCrossed,
  snack: Cookie,
  dinner: Moon,
};

/**
 * Icône d'une catégorie de repas.
 *
 * - Si une image custom existe dans MEAL_IMAGE (ex: breakfast),
 *   on la rend en taille `imageClassName` (par défaut couvre toute
 *   la pastille pour un rendu illustration).
 * - Sinon, on rend l'icône lucide en taille `lucideClassName`
 *   (plus petite pour rester centrée dans la pastille).
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
        className={`${imageClassName} rounded-full object-cover`}
      />
    );
  }
  const Lucide = MEAL_LUCIDE[category];
  return <Lucide className={lucideClassName} />;
}
