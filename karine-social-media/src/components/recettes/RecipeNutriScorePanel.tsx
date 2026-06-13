import type { NutriscoreGrade } from '@/lib/nutriscore';
import { NutriScoreBadge } from './NutriScoreBadge';
import { NutriScoreInfoLink } from './NutriScoreInfoLink';
import { NutriScoreDetailLink } from './NutriScoreDetailLink';
import type { CiqualFoodLite } from '@/lib/nutriscore-aggregate';
import type { RecipeIngredient } from '@/data/recipes';

/**
 * Bandeau Nutri-Score sous l'image de la fiche recette.
 *
 * V3 (2026-06-08) : ajoute le bouton "Détail nutritionnel" qui ouvre
 * une modale avec le breakdown ingrédient par ingrédient (poids, kcal,
 * AGS, sucres, fibres, sel…) basé sur Ciqual ANSES.
 *
 * Le badge utilise la variante 'karine' (douce, sans bandeau noir),
 * et 2 liens en dessous :
 *   - ⓘ Base de calcul  → règles génériques Nutri-Score 2024
 *   - 🥕 Détail nutritionnel → breakdown spécifique à cette recette
 */
export function RecipeNutriScorePanel({
  grade,
  ingredients,
  ciqualByIdEntries,
  portionWeightEntries = [],
}: {
  grade: NutriscoreGrade;
  ingredients: RecipeIngredient[];
  ciqualByIdEntries: Array<[number, CiqualFoodLite]>;
  portionWeightEntries?: Array<[string, number]>;
}) {
  const hasDetail = ciqualByIdEntries.length > 0 && ingredients.length > 0;
  return (
    <div className="mx-auto flex w-fit max-w-full flex-col items-center gap-1.5">
      <NutriScoreBadge grade={grade} size="sm" headerVariant="karine" />
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <NutriScoreInfoLink />
        {hasDetail && (
          <NutriScoreDetailLink
            ingredients={ingredients}
            ciqualByIdEntries={ciqualByIdEntries}
            portionWeightEntries={portionWeightEntries}
          />
        )}
      </div>
    </div>
  );
}
