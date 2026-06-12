import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import {
  aggregateIngredients,
  applySaltDefault,
  quickMatchCiqual,
  type CiqualFoodLite,
} from '@/lib/nutriscore-aggregate';
import { computeNutriscore } from '@/lib/nutriscore';
import { resolveUnitWeights } from '@/lib/ciqual-unit-weight';
import type { RecipeIngredient } from '@/data/recipes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Calcule le Nutri-Score d'une fiche détaillée et persiste les colonnes
 * `nutriscore_grade`, `nutriscore_points`, `nutriscore_confidence` et
 * `nutriscore_computed_at` sur `recipe_sheets`.
 *
 * Appelé à chaque save admin qui touche aux ingrédients d'une fiche :
 *  - PATCH /api/admin/recipes/[slug]/sheets/[sheetId]   (édition ingredients)
 *  - POST  /api/admin/recipes/[slug]/sheets             (création sheet)
 *  - autres forms admin qui modifient les ingredients
 *
 * Les pages de lecture (utilisateur et admin liste) lisent ces colonnes
 * sans recalcul. Gain : ~1 s de latence en moins par page.
 *
 * Tolérant aux erreurs : si la migration nutriscore_* n'a pas encore
 * été appliquée en BDD, ou si le calcul échoue, on log et on n'écrit
 * rien (le save de la sheet a déjà réussi en amont).
 */
async function fetchCiqualPaginated(supa: any): Promise<CiqualFoodLite[]> {
  const all: CiqualFoodLite[] = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const { data } = await supa
      .from('ciqual_foods')
      .select(
        'id, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g, fibers_g, sugars_g, saturated_fat_g, salt_g, sodium_mg',
      )
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    const arr = (data ?? []) as CiqualFoodLite[];
    if (arr.length === 0) break;
    all.push(...arr);
    if (arr.length < 1000) break;
  }
  return all;
}

export async function persistNutriscoreForSheet(sheetId: string): Promise<void> {
  try {
    const supa = createServiceClient() as any;
    const { data: sheet, error: errSheet } = await supa
      .from('recipe_sheets')
      .select('id, ingredients')
      .eq('id', sheetId)
      .single();
    if (errSheet || !sheet) {
      console.warn('[nutriscore-persist] sheet introuvable', sheetId, errSheet?.message);
      return;
    }

    const ingredients = (Array.isArray(sheet.ingredients) ? sheet.ingredients : []) as RecipeIngredient[];
    const now = new Date().toISOString();

    // Cas vide : on stocke des NULL + timestamp pour marquer qu'on a essayé.
    if (ingredients.length === 0) {
      await supa
        .from('recipe_sheets')
        .update({
          nutriscore_grade: null,
          nutriscore_points: null,
          nutriscore_confidence: null,
          nutriscore_computed_at: now,
        })
        .eq('id', sheetId);
      return;
    }

    const ciqualFoods = await fetchCiqualPaginated(supa);
    const ciqualGroups = new Map(
      ciqualFoods.map((c) => [c.id, (c as any).group_name ?? '']),
    );

    // Règle ANSES "sel sans qty" : on force 0.5g pour que l'apport
    // sodium soit pris en compte. À faire AVANT l'auto-link Ciqual
    // pour que le sel par défaut puisse aussi se lier à "Sel marin".
    const { resolved: saltNormalized, mutated: saltMutated } =
      applySaltDefault(ingredients);

    // Auto-link Ciqual : pour chaque ingrédient sans ciqual_food_id,
    // on tente un quickMatch et on persiste le lien. Permet à la modale
    // "Détail nutritionnel" de retrouver les valeurs nutritionnelles par
    // ingrédient sans devoir relancer le matching côté client.
    let linkMutated = false;
    const resolvedIngredients = saltNormalized.map((ing) => {
      if (typeof ing.ciqual_food_id === 'number') return ing;
      const match = quickMatchCiqual(ing.label, ciqualFoods);
      if (!match) return ing;
      linkMutated = true;
      return { ...ing, ciqual_food_id: match.id };
    });
    const mutated = saltMutated || linkMutated;

    // Pour les ingrédients sans unit de poids/volume mais avec un
    // Ciqual lié, on a besoin du poids unitaire (« 1 tomate cerise ≈ 15g »).
    // resolveUnitWeights lookup BDD puis fallback Mistral pour ce qui
    // manque. Throttle interne 1 req/s pour Mistral free tier.
    const needWeight = resolvedIngredients
      .filter(
        (ing) =>
          typeof ing.quantity === 'number' &&
          ing.quantity > 0 &&
          (!ing.unit || ing.unit.trim() === '') &&
          typeof ing.ciqual_food_id === 'number',
      )
      .map((ing) => {
        const c = ciqualFoods.find((f) => f.id === ing.ciqual_food_id);
        return { ciqualId: ing.ciqual_food_id as number, ciqualName: c?.name ?? ing.label };
      });
    const ciqualUnitWeights = await resolveUnitWeights(needWeight);

    const agg = aggregateIngredients(
      resolvedIngredients,
      ciqualFoods,
      ciqualGroups,
      ciqualUnitWeights,
    );

    if (agg.totalGrams === 0) {
      // Aucun ingrédient calculable (pas de qty)
      await supa
        .from('recipe_sheets')
        .update({
          nutriscore_grade: null,
          nutriscore_points: null,
          nutriscore_confidence: 0,
          nutriscore_computed_at: now,
          ...(mutated ? { ingredients: resolvedIngredients } : {}),
        })
        .eq('id', sheetId);
      return;
    }

    const score = computeNutriscore(agg.per100g, 'GENERIC');
    const { error: errUpd } = await supa
      .from('recipe_sheets')
      .update({
        nutriscore_grade: score.grade,
        nutriscore_points: score.points,
        nutriscore_confidence: Number(agg.confidence.toFixed(3)),
        nutriscore_computed_at: now,
        ...(mutated ? { ingredients: resolvedIngredients } : {}),
      })
      .eq('id', sheetId);
    if (errUpd) {
      console.warn(
        '[nutriscore-persist] échec update — migration appliquée ?',
        errUpd.message,
      );
    }
  } catch (e) {
    console.error('[nutriscore-persist] erreur inattendue', e);
  }
}

/**
 * Variante pour les fiches repas d'un menu hebdomadaire
 * (table menu_meal_sheets). Mêmes colonnes nutriscore_* à mettre à
 * jour, même pipeline de calcul (le shape des ingredients est
 * identique : RecipeIngredient).
 */
export async function persistNutriscoreForMenuMealSheet(
  sheetId: string,
): Promise<void> {
  try {
    const supa = createServiceClient() as any;
    const { data: sheet, error: errSheet } = await supa
      .from('menu_meal_sheets')
      .select('id, ingredients')
      .eq('id', sheetId)
      .single();
    if (errSheet || !sheet) {
      console.warn('[nutriscore-persist menu] sheet introuvable', sheetId, errSheet?.message);
      return;
    }

    const ingredients = (Array.isArray(sheet.ingredients) ? sheet.ingredients : []) as RecipeIngredient[];
    const now = new Date().toISOString();

    if (ingredients.length === 0) {
      await supa
        .from('menu_meal_sheets')
        .update({
          nutriscore_grade: null,
          nutriscore_points: null,
          nutriscore_confidence: null,
          nutriscore_computed_at: now,
        })
        .eq('id', sheetId);
      return;
    }

    const ciqualFoods = await fetchCiqualPaginated(supa);
    const ciqualGroups = new Map(
      ciqualFoods.map((c) => [c.id, (c as any).group_name ?? '']),
    );

    // Règle ANSES "sel par défaut" + auto-link Ciqual (cf. helper recipe).
    const { resolved: saltNormalized, mutated: saltMutated } =
      applySaltDefault(ingredients);
    let linkMutated = false;
    const resolvedIngredients = saltNormalized.map((ing) => {
      if (typeof ing.ciqual_food_id === 'number') return ing;
      const match = quickMatchCiqual(ing.label, ciqualFoods);
      if (!match) return ing;
      linkMutated = true;
      return { ...ing, ciqual_food_id: match.id };
    });
    const mutated = saltMutated || linkMutated;

    // Résolution poids unitaire pour ingrédients sans unit (cf. helper recipe).
    const needWeight = resolvedIngredients
      .filter(
        (ing) =>
          typeof ing.quantity === 'number' &&
          ing.quantity > 0 &&
          (!ing.unit || ing.unit.trim() === '') &&
          typeof ing.ciqual_food_id === 'number',
      )
      .map((ing) => {
        const c = ciqualFoods.find((f) => f.id === ing.ciqual_food_id);
        return { ciqualId: ing.ciqual_food_id as number, ciqualName: c?.name ?? ing.label };
      });
    const ciqualUnitWeights = await resolveUnitWeights(needWeight);

    const agg = aggregateIngredients(
      resolvedIngredients,
      ciqualFoods,
      ciqualGroups,
      ciqualUnitWeights,
    );

    if (agg.totalGrams === 0) {
      await supa
        .from('menu_meal_sheets')
        .update({
          nutriscore_grade: null,
          nutriscore_points: null,
          nutriscore_confidence: 0,
          nutriscore_computed_at: now,
          ...(mutated ? { ingredients: resolvedIngredients } : {}),
        })
        .eq('id', sheetId);
      return;
    }

    const score = computeNutriscore(agg.per100g, 'GENERIC');
    const { error: errUpd } = await supa
      .from('menu_meal_sheets')
      .update({
        nutriscore_grade: score.grade,
        nutriscore_points: score.points,
        nutriscore_confidence: Number(agg.confidence.toFixed(3)),
        nutriscore_computed_at: now,
        ...(mutated ? { ingredients: resolvedIngredients } : {}),
      })
      .eq('id', sheetId);
    if (errUpd) {
      console.warn(
        '[nutriscore-persist menu] échec update — migration appliquée ?',
        errUpd.message,
      );
    }
  } catch (e) {
    console.error('[nutriscore-persist menu] erreur inattendue', e);
  }
}

/**
 * Recalcule toutes les sheets d'une recette. Utilisé quand on ne sait
 * pas quelle sheet a été modifiée (création en lot, import, etc.).
 */
export async function persistNutriscoreForRecipe(recipeId: number): Promise<void> {
  const supa = createServiceClient() as any;
  const { data: sheets } = await supa
    .from('recipe_sheets')
    .select('id')
    .eq('recipe_id', recipeId);
  for (const s of (sheets ?? []) as Array<{ id: string }>) {
    await persistNutriscoreForSheet(s.id);
  }
}
