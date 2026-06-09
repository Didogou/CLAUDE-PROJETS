'use client';

import { MesCaloriesView } from './MesCaloriesView';

/**
 * Wrapper client pour la route /mes-calories.
 *
 * Branchement 2026-06-09 v2 : on utilise `MesCaloriesView` (rendu propre
 * en flow normal) au lieu de `CalorieCounterSheetV2 asPage` (gros
 * composant sheet legacy avec scroll interne qui empêchait le header
 * de se compacter au scroll).
 *
 * Le composant `CalorieCounterSheetV2` reste disponible pour les
 * usages SHEET (CalorieFAB, etc.).
 */
export function MesCaloriesPageClient() {
  return <MesCaloriesView />;
}
