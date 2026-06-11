'use client';

/**
 * Helper pour déclencher l'animation d'ajout sur l'icône BottomNav :
 *   1. Pulsation 3× sur l'icône (~1.8s)
 *   2. "+1" qui flotte 2s au-dessus de l'icône puis fade out
 *
 * À appeler après chaque ajout réussi à la liste de courses ou aux
 * repas, peu importe d'où dans l'app (fiche recette, menu, etc.).
 *
 * BottomNav écoute l'event 'bottom-nav-pulse' et applique l'animation.
 */

export type PulseTarget = 'courses' | 'meals';

export function pulseBottomNav(target: PulseTarget): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('bottom-nav-pulse', { detail: { target } }),
  );
}
