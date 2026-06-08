import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { NutriscoreGrade } from '@/lib/nutriscore';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Helpers de lecture du Nutri-Score pour les menus de la semaine.
 *
 * Stratégie (validée 2026-06-08) :
 *  - Chaque case lunch/dinner d'un day peut référencer une recette
 *    via lunch_recipe_slug / dinner_recipe_slug.
 *  - Si la case pointe vers une recette → on REUTILISE le score
 *    persisté sur recipe_sheets[sheet_index=0].nutriscore_grade.
 *  - Si pas de recette liée (repas libre, texte/image seuls) → vide.
 *
 * Pas de recalcul à la volée pour les menus : tout est SELECT.
 * Performances : 2 requêtes (menus + days, et scores) au lieu de
 * potentiellement 14 × N (jours × menus × recettes).
 */

export type MealSlot = 'lunch' | 'dinner';

export type RecipeScoreLite = {
  slug: string;
  grade: NutriscoreGrade | null;
  confidence: number | null;
};

/**
 * Récupère les scores de toutes les recettes référencées par un set
 * de slugs (collectés sur les menus). On prend la sheet d'index 0 de
 * chaque recette comme représentative (même règle que côté fiche).
 */
export async function getRecipeScoresBySlug(
  slugs: string[],
): Promise<Map<string, RecipeScoreLite>> {
  const out = new Map<string, RecipeScoreLite>();
  if (slugs.length === 0) return out;

  const supa = createServiceClient() as any;
  // 1 query : recipes.slug → sheet[0].nutriscore_grade / confidence.
  const { data } = await supa
    .from('recipes')
    .select(
      'slug, recipe_sheets!inner(sheet_index, nutriscore_grade, nutriscore_confidence)',
    )
    .in('slug', slugs)
    .eq('recipe_sheets.sheet_index', 0);

  for (const row of (data ?? []) as Array<{
    slug: string;
    recipe_sheets: Array<{
      sheet_index: number;
      nutriscore_grade: string | null;
      nutriscore_confidence: number | string | null;
    }>;
  }>) {
    const sheet = row.recipe_sheets?.[0];
    if (!sheet) continue;
    const g = sheet.nutriscore_grade;
    const grade: NutriscoreGrade | null =
      g === 'A' || g === 'B' || g === 'C' || g === 'D' || g === 'E' ? g : null;
    const confidence =
      typeof sheet.nutriscore_confidence === 'number'
        ? sheet.nutriscore_confidence
        : sheet.nutriscore_confidence !== null && sheet.nutriscore_confidence !== undefined
          ? Number(sheet.nutriscore_confidence)
          : null;
    out.set(row.slug, { slug: row.slug, grade, confidence });
  }
  return out;
}

const POINTS_BY_GRADE: Record<NutriscoreGrade, number> = {
  A: -1,
  B: 1,
  C: 6,
  D: 14,
  E: 22,
};

export function pointsToGrade(pts: number): NutriscoreGrade {
  return pts <= 0 ? 'A' : pts <= 2 ? 'B' : pts <= 10 ? 'C' : pts <= 18 ? 'D' : 'E';
}

/**
 * Calcule la moyenne hebdomadaire d'un menu à partir des scores des
 * recettes liées à ses jours (lunch + dinner). Cases sans recette ou
 * sans score sont ignorées. Confiance minimale 0.5.
 */
export function computeMenuAvgGrade(
  scoresInMenu: Array<RecipeScoreLite | null>,
): { grade: NutriscoreGrade; confidence: number; count: number } | null {
  const valid = scoresInMenu.filter(
    (s): s is RecipeScoreLite & { grade: NutriscoreGrade; confidence: number } =>
      !!s && s.grade !== null && (s.confidence ?? 0) >= 0.5,
  );
  if (valid.length === 0) return null;
  const avgPts =
    valid.reduce((sum, s) => sum + POINTS_BY_GRADE[s.grade], 0) / valid.length;
  const avgConf =
    valid.reduce((sum, s) => sum + s.confidence, 0) / valid.length;
  return {
    grade: pointsToGrade(avgPts),
    confidence: avgConf,
    count: valid.length,
  };
}
