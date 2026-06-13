/**
 * Calcul des macros (protéines, lipides, glucides) d'une fiche
 * détaillée à partir de ses ingrédients × table Ciqual.
 *
 * Approche pragmatique V1 :
 *   - Chaque ingrédient a éventuellement un `ciqual_food_id`
 *   - Le lookup Ciqual donne les valeurs par 100g (proteins_g, etc.)
 *   - On convertit la quantité de l'ingrédient en GRAMMES
 *   - On somme, puis on divise par le nombre de portions
 *
 * Conversions unités → grammes :
 *   - "g", "gr", null         → quantity tel quel
 *   - "kg"                    → × 1000
 *   - "mg"                    → ÷ 1000
 *   - "ml", "cl", "l"         → assume densité 1 g/ml (eau ; approximation
 *                               valable pour la majorité des ingrédients
 *                               liquides courants — eau, lait, jus)
 *   - "pièce", "unité", "u"   → × ciqual.avg_unit_weight_g (si disponible)
 *   - "c.c.", "c.s."          → tables standard FR (cuiller à café/soupe)
 *   - autre                   → ignoré (loggé en coverage manquante)
 *
 * Couverture (% d'ingrédients pris en compte) retournée pour signaler
 * un calcul incomplet : si < 60%, le résultat est probablement faux et
 * mieux vaut afficher "non disponible" côté UI.
 */

import type { RecipeIngredient } from '@/data/recipes';

export type CiqualMacroRow = {
  id: number;
  /** Code ANSES STABLE — clé de liaison canonique. */
  alim_code: number;
  proteins_g: number | null;
  lipids_g: number | null;
  carbs_g: number | null;
  kcal_per_100g: number | null;
  avg_unit_weight_g: number | null;
};

export type ComputedMacros = {
  /** Valeur PAR PORTION (g), null si impossible à calculer. */
  proteinsG: number | null;
  lipidsG: number | null;
  carbsG: number | null;
  /** Kcal calculées (pour cohérence si Karine n'a pas saisi le total). */
  kcalComputed: number | null;
  /** Couverture 0..1 = (ingrédients pris en compte) / (ingrédients totaux). */
  coverage: number;
  /** Liste des labels d'ingrédients qu'on n'a PAS pu inclure. */
  skipped: string[];
};

/** Conversion d'une quantité en GRAMMES selon l'unité. */
function toGrams(
  quantity: number,
  unit: string | null,
  avgUnitWeightG: number | null,
): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const u = (unit ?? '').trim().toLowerCase();
  if (!u || u === 'g' || u === 'gr' || u === 'gramme' || u === 'grammes') {
    return quantity;
  }
  if (u === 'kg') return quantity * 1000;
  if (u === 'mg') return quantity / 1000;
  // Liquides : approximation densité 1 g/ml
  if (u === 'ml') return quantity;
  if (u === 'cl') return quantity * 10;
  if (u === 'dl') return quantity * 100;
  if (u === 'l' || u === 'litre' || u === 'litres') return quantity * 1000;
  // Unités-pièces : besoin du poids moyen Ciqual
  if (
    u === 'pièce' ||
    u === 'piece' ||
    u === 'pièces' ||
    u === 'pieces' ||
    u === 'unité' ||
    u === 'unite' ||
    u === 'unités' ||
    u === 'unites' ||
    u === 'u'
  ) {
    return avgUnitWeightG && avgUnitWeightG > 0
      ? quantity * avgUnitWeightG
      : null;
  }
  // Cuillères (tables FR standard, biais 10% acceptable pour V1)
  if (u === 'c.c.' || u === 'cc' || u === "c. à c." || u === 'cuiller à café')
    return quantity * 5;
  if (u === 'c.s.' || u === 'cs' || u === "c. à s." || u === 'cuiller à soupe')
    return quantity * 15;
  // Verre (FR, 200 ml)
  if (u === 'verre' || u === 'verres') return quantity * 200;
  // Pincée (~1g)
  if (u === 'pincée' || u === 'pincee' || u === 'pincées') return quantity * 1;
  return null;
}

/**
 * Calcule les macros d'une fiche.
 *
 * @param ingredients  Liste des ingrédients de la fiche (avec ciqual_alim_code idéalement)
 * @param servings     Nombre de portions de la fiche
 * @param ciqualByCode Map alim_code Ciqual → ligne nutritionnelle
 * @returns Macros PAR PORTION + couverture
 */
export function computeSheetMacros(
  ingredients: RecipeIngredient[] | null | undefined,
  servings: number,
  ciqualByCode: Map<number, CiqualMacroRow>,
): ComputedMacros {
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return {
      proteinsG: null,
      lipidsG: null,
      carbsG: null,
      kcalComputed: null,
      coverage: 0,
      skipped: [],
    };
  }
  const safeServings = servings > 0 ? servings : 4;
  let totalProteins = 0;
  let totalLipids = 0;
  let totalCarbs = 0;
  let totalKcal = 0;
  let covered = 0;
  const skipped: string[] = [];

  for (const ing of ingredients) {
    const alimCode = ing.ciqual_alim_code ?? null;
    if (!alimCode) {
      skipped.push(ing.label);
      continue;
    }
    const ciqual = ciqualByCode.get(alimCode);
    if (!ciqual) {
      skipped.push(ing.label);
      continue;
    }
    if (typeof ing.quantity !== 'number' || !Number.isFinite(ing.quantity)) {
      skipped.push(ing.label);
      continue;
    }
    const grams = toGrams(ing.quantity, ing.unit, ciqual.avg_unit_weight_g);
    if (grams === null || grams <= 0) {
      skipped.push(`${ing.label} (unité '${ing.unit ?? '?'}' non convertible)`);
      continue;
    }
    // Ratio par 100g → grammes réels
    const factor = grams / 100;
    if (ciqual.proteins_g !== null) totalProteins += ciqual.proteins_g * factor;
    if (ciqual.lipids_g !== null) totalLipids += ciqual.lipids_g * factor;
    if (ciqual.carbs_g !== null) totalCarbs += ciqual.carbs_g * factor;
    if (ciqual.kcal_per_100g !== null)
      totalKcal += ciqual.kcal_per_100g * factor;
    covered++;
  }

  const coverage = covered / ingredients.length;
  // Si couverture < 30% on retourne null pour ne pas afficher de
  // valeurs trompeuses. Sinon on divise par portions.
  if (coverage < 0.3) {
    return {
      proteinsG: null,
      lipidsG: null,
      carbsG: null,
      kcalComputed: null,
      coverage,
      skipped,
    };
  }
  return {
    proteinsG: Math.round((totalProteins / safeServings) * 10) / 10,
    lipidsG: Math.round((totalLipids / safeServings) * 10) / 10,
    carbsG: Math.round((totalCarbs / safeServings) * 10) / 10,
    kcalComputed: Math.round(totalKcal / safeServings),
    coverage,
    skipped,
  };
}

/**
 * Helper : récupère les lignes Ciqual nécessaires pour une liste
 * d'ingrédients en 1 query batch.
 */
export async function fetchCiqualForIngredients(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ingredients: RecipeIngredient[] | null | undefined,
): Promise<Map<number, CiqualMacroRow>> {
  const map = new Map<number, CiqualMacroRow>();
  if (!Array.isArray(ingredients) || ingredients.length === 0) return map;
  const codes = new Set<number>();
  for (const ing of ingredients) {
    if (ing.ciqual_alim_code && Number.isFinite(ing.ciqual_alim_code)) {
      codes.add(Number(ing.ciqual_alim_code));
    }
  }
  if (codes.size === 0) return map;
  const { data } = await supabase
    .from('ciqual_foods')
    .select('id, alim_code, proteins_g, lipids_g, carbs_g, kcal_per_100g, avg_unit_weight_g')
    .in('alim_code', [...codes]);
  for (const row of (data ?? []) as CiqualMacroRow[]) {
    map.set(Number(row.alim_code), row);
  }
  return map;
}
