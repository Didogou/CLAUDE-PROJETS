import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/admin/recipes-meal-test
 *
 * Liste toutes les fiches détaillées (recipe_sheets) pour la page de
 * test admin. Renvoie les champs nécessaires pour faire passer chaque
 * fiche dans /api/nutrition/parse comme si l'utilisatrice ajoutait
 * un repas par photo.
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recipes, error } = await (supabase as any)
    .from('recipes')
    .select('id, slug, title')
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
    .select('id, recipe_id, sheet_index, title, cover_image_url, calories')
    .in('recipe_id', recipeIds)
    .order('sheet_index', { ascending: true });

  type SheetRow = {
    id: string;
    recipe_id: number | string;
    sheet_index: number;
    title: string | null;
    cover_image_url: string | null;
    calories: number | null;
  };
  const sheetsByRecipe = new Map<string | number, SheetRow[]>();
  for (const s of (sheets ?? []) as SheetRow[]) {
    const arr = sheetsByRecipe.get(s.recipe_id) ?? [];
    arr.push(s);
    sheetsByRecipe.set(s.recipe_id, arr);
  }

  const result = recipeRows.flatMap((r) => {
    const sheetRows = sheetsByRecipe.get(r.id) ?? [];
    return sheetRows.map((s) => ({
      sheetId: s.id,
      recipeSlug: r.slug,
      recipeTitle: r.title,
      sheetIndex: s.sheet_index,
      sheetTitle: s.title,
      coverImageUrl: s.cover_image_url,
      calories: s.calories,
      // Texte par défaut à parser : titre fiche si présent, sinon titre recette.
      defaultParseText: (s.title || r.title || '').trim(),
    }));
  });

  return NextResponse.json({
    total: result.length,
    items: result,
  });
}
