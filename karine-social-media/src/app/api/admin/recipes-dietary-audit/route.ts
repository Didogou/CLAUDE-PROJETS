import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { auditSheetDietary } from '@/lib/dietary-tags';
import type { RecipeIngredient } from '@/data/recipes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Lecture de toutes les recettes + sheets. Peut prendre ~5s.
export const maxDuration = 30;

/**
 * GET /api/admin/recipes-dietary-audit
 *
 * Renvoie pour chaque recette publiée + chaque fiche détaillée :
 *   - les 3 tags effectifs (vegetarian / glutenFree / porkFree)
 *   - la justification (auto + override + ingrédient bloquant)
 *
 * La décision finale est calculée par `computeSheetDietaryTags` (même
 * fonction que celle utilisée pour afficher les labels côté
 * utilisatrice) → 0 risque de divergence audit ↔ affichage.
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recipes, error } = await (supabase as any)
    .from('recipes')
    .select('id, slug, title, status')
    .order('title', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recipeRows = (recipes ?? []) as Array<any>;
  const recipeIds = recipeRows.map((r) => r.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sheets } = await (supabase as any)
    .from('recipe_sheets')
    .select(
      'id, recipe_id, sheet_index, title, ingredients, is_vegetarian_override, is_gluten_free_override, is_pork_free_override',
    )
    .in('recipe_id', recipeIds)
    .order('sheet_index', { ascending: true });

  type SheetRow = {
    id: string;
    recipe_id: number | string;
    sheet_index: number;
    title: string | null;
    ingredients: RecipeIngredient[] | null;
    is_vegetarian_override: boolean | null;
    is_gluten_free_override: boolean | null;
    is_pork_free_override: boolean | null;
  };
  const sheetsByRecipe = new Map<string | number, SheetRow[]>();
  for (const s of (sheets ?? []) as SheetRow[]) {
    const arr = sheetsByRecipe.get(s.recipe_id) ?? [];
    arr.push(s);
    sheetsByRecipe.set(s.recipe_id, arr);
  }

  const result = recipeRows.map((r) => {
    const sheetRows = sheetsByRecipe.get(r.id) ?? [];
    return {
      recipeId: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      sheets: sheetRows.map((s) => ({
        sheetId: s.id,
        sheetIndex: s.sheet_index,
        sheetTitle: s.title,
        ingredientsCount: Array.isArray(s.ingredients)
          ? s.ingredients.length
          : 0,
        audit: auditSheetDietary(
          s.ingredients,
          s.is_vegetarian_override,
          s.is_gluten_free_override,
          s.is_pork_free_override,
        ),
      })),
    };
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    recipesCount: result.length,
    sheetsCount: result.reduce((acc, r) => acc + r.sheets.length, 0),
    recipes: result,
  });
}
