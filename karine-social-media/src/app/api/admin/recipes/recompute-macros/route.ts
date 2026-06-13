import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import {
  computeSheetMacros,
  fetchCiqualForIngredients,
  type CiqualMacroRow,
} from '@/lib/recipe-macros';
import type { RecipeIngredient } from '@/data/recipes';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/recipes/recompute-macros
 *
 * Recalcule les macros (proteins_g, lipids_g, carbs_g) de TOUTES les
 * recipe_sheets à partir des ingrédients × Ciqual. À lancer après une
 * mise à jour massive Ciqual ou de la lib de calcul.
 *
 * Renvoie un récap : nb sheets traitées, % couverture moyen, ingrédients
 * skippés (top 20). Pas de fail-stop : si une sheet n'a pas assez de
 * couverture Ciqual, on met les colonnes à null et on log dans skipped.
 */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient();

  // 1) Tire toutes les sheets avec leurs ingrédients
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sheets, error } = await (supabase as any)
    .from('recipe_sheets')
    .select('id, ingredients, servings');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type SheetRow = {
    id: string;
    ingredients: RecipeIngredient[] | null;
    servings: number | null;
  };
  const sheetRows = (sheets ?? []) as SheetRow[];

  // 2) Charge UNE FOIS toutes les lignes Ciqual nécessaires (batch global)
  const allCodes = new Set<number>();
  for (const s of sheetRows) {
    for (const ing of s.ingredients ?? []) {
      if (ing.ciqual_alim_code && Number.isFinite(ing.ciqual_alim_code)) {
        allCodes.add(Number(ing.ciqual_alim_code));
      }
    }
  }
  const ciqualByCode = new Map<number, CiqualMacroRow>();
  if (allCodes.size > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cRows } = await (supabase as any)
      .from('ciqual_foods')
      .select('id, alim_code, proteins_g, lipids_g, carbs_g, kcal_per_100g, avg_unit_weight_g')
      .in('alim_code', [...allCodes]);
    for (const row of (cRows ?? []) as CiqualMacroRow[]) {
      ciqualByCode.set(Number(row.alim_code), row);
    }
  }

  // 3) Pour chaque sheet : compute + update
  let updated = 0;
  let withMacros = 0;
  let coverageSum = 0;
  const skippedCounts = new Map<string, number>();
  for (const s of sheetRows) {
    const result = computeSheetMacros(
      s.ingredients,
      Number(s.servings) || 4,
      ciqualByCode,
    );
    coverageSum += result.coverage;
    if (result.proteinsG !== null) withMacros++;
    for (const sk of result.skipped) {
      skippedCounts.set(sk, (skippedCounts.get(sk) ?? 0) + 1);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: uErr } = await (supabase as any)
      .from('recipe_sheets')
      .update({
        proteins_g: result.proteinsG,
        lipids_g: result.lipidsG,
        carbs_g: result.carbsG,
      })
      .eq('id', s.id);
    if (!uErr) updated++;
  }
  // Fix string fetchCiqualForIngredients unused warning
  void fetchCiqualForIngredients;

  const topSkipped = [...skippedCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([label, count]) => ({ label, count }));

  // === ÉTAGE 2 — menu_meal_sheets (fiches repas des menus) ============
  // Même mécanique sur la table des fiches repas. Beaucoup plus
  // d'utilisation au quotidien que les recipe_sheets (Karine ajoute
  // surtout depuis ses menus de la semaine).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mmsRows } = await (supabase as any)
    .from('menu_meal_sheets')
    .select('id, ingredients, servings');
  type MMSRow = {
    id: string;
    ingredients: RecipeIngredient[] | null;
    servings: number | null;
  };
  const mmsArr = (mmsRows ?? []) as MMSRow[];

  // Charge les ciqual_ids manquants depuis les fiches menus
  const additionalCodes = new Set<number>();
  for (const m of mmsArr) {
    for (const ing of m.ingredients ?? []) {
      if (
        ing.ciqual_alim_code &&
        Number.isFinite(ing.ciqual_alim_code) &&
        !ciqualByCode.has(Number(ing.ciqual_alim_code))
      ) {
        additionalCodes.add(Number(ing.ciqual_alim_code));
      }
    }
  }
  if (additionalCodes.size > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cRows2 } = await (supabase as any)
      .from('ciqual_foods')
      .select('id, alim_code, proteins_g, lipids_g, carbs_g, kcal_per_100g, avg_unit_weight_g')
      .in('alim_code', [...additionalCodes]);
    for (const row of (cRows2 ?? []) as CiqualMacroRow[]) {
      ciqualByCode.set(Number(row.alim_code), row);
    }
  }

  let mmsUpdated = 0;
  let mmsWithMacros = 0;
  let mmsCoverageSum = 0;
  const mmsSkipped = new Map<string, number>();
  for (const m of mmsArr) {
    const result = computeSheetMacros(
      m.ingredients,
      Number(m.servings) || 4,
      ciqualByCode,
    );
    mmsCoverageSum += result.coverage;
    if (result.proteinsG !== null) mmsWithMacros++;
    for (const sk of result.skipped) {
      mmsSkipped.set(sk, (mmsSkipped.get(sk) ?? 0) + 1);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: uErr } = await (supabase as any)
      .from('menu_meal_sheets')
      .update({
        proteins_g: result.proteinsG,
        lipids_g: result.lipidsG,
        carbs_g: result.carbsG,
      })
      .eq('id', m.id);
    if (!uErr) mmsUpdated++;
  }

  const topMmsSkipped = [...mmsSkipped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([label, count]) => ({ label, count }));

  return NextResponse.json({
    recipeSheets: {
      total: sheetRows.length,
      updated,
      withMacros,
      coverageAverage:
        sheetRows.length > 0
          ? Math.round((coverageSum / sheetRows.length) * 100) / 100
          : 0,
      topSkipped,
    },
    menuMealSheets: {
      total: mmsArr.length,
      updated: mmsUpdated,
      withMacros: mmsWithMacros,
      coverageAverage:
        mmsArr.length > 0
          ? Math.round((mmsCoverageSum / mmsArr.length) * 100) / 100
          : 0,
      topSkipped: topMmsSkipped,
    },
  });
}
