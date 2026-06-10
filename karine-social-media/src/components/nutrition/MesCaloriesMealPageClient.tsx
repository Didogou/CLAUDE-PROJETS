'use client';

import { useRouter } from 'next/navigation';
import {
  CalorieCounterSheetV2,
  MEAL_FROM_URL_SLUG,
} from './CalorieCounterSheetV2';

/**
 * Wrapper client pour /mes-calories/[meal] — sub-page d'un repas.
 *
 * Convertit le slug FR (petit-dej / dejeuner / gouter / diner) vers la
 * `MealCategory` interne (breakfast / lunch / snack / dinner) et passe
 * en prop `initialMealCategory` au composant principal, qui démarre
 * alors directement sur la sub-page voulue avec son drill-down state
 * déjà ouvert.
 *
 * Le mode 'add' / 'view' est passé via `initialSubPageMode`.
 *
 * Le bouton "retour" custom de la sub-page utilise `useUrlNavigation`
 * pour naviguer vers /mes-calories (back propre, indépendant du back
 * natif du navigateur — qui marche aussi de toute façon).
 */
export function MesCaloriesMealPageClient({
  slug,
  mode,
  prefillDesc,
  prefillPhoto,
  fromUrl,
}: {
  slug: 'petit-dej' | 'dejeuner' | 'gouter' | 'diner';
  mode: 'add' | 'view';
  /** Si fourni (via le FAB camera dans BottomNav), prerempli l'invite
   *  "Ajouter un plat" avec cette description Vision et lance auto-parse. */
  prefillDesc?: string | null;
  /** Si fourni, photo deja uploadee a associer aux entries crees. */
  prefillPhoto?: string | null;
  /** Si fourni, URL vers laquelle revenir apres validation du plat
   *  (page d'origine d'ou l'utilisatrice a clique le FAB). */
  fromUrl?: string | null;
}) {
  const router = useRouter();
  const category = MEAL_FROM_URL_SLUG[slug];
  return (
    <CalorieCounterSheetV2
      asPage
      useUrlNavigation
      initialMealCategory={category}
      initialSubPageMode={mode}
      initialNaturalText={prefillDesc ?? undefined}
      initialPhotoUrl={prefillPhoto ?? undefined}
      returnUrl={fromUrl ?? undefined}
      onClose={() => router.push('/mes-calories')}
      onChanged={() => {
        /* refresh local géré par le composant */
      }}
    />
  );
}
