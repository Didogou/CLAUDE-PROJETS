'use client';

import { useRouter } from 'next/navigation';
import { CalorieCounterSheetV2 } from './CalorieCounterSheetV2';

/**
 * Wrapper client pour la route /mes-calories.
 *
 * Réutilise le composant `CalorieCounterSheetV2` existant en mode page
 * (prop `asPage` = true) : pas de createPortal, pas de wrapper sheet
 * `fixed inset-0`. Le contenu est rendu directement dans le flow DOM
 * de la page, sous le AppHeader.
 *
 * Les callbacks `onClose` et `onChanged` :
 *  - `onClose` : redirige vers la home (le user a cliqué la flèche
 *    back du header sub-page, équivalent à "fermer la sheet"). En
 *    pratique Phase 2, on remplacera par une vraie navigation
 *    inter-pages drill-down.
 *  - `onChanged` : pas d'action — la page se rafraîchit toute seule.
 */
export function MesCaloriesPageClient() {
  const router = useRouter();
  return (
    <CalorieCounterSheetV2
      asPage
      useUrlNavigation
      onClose={() => router.push('/')}
      onChanged={() => {
        /* refresh local géré par le composant lui-même */
      }}
    />
  );
}
