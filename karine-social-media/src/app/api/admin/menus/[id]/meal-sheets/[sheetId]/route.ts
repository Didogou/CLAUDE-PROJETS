import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { persistNutriscoreForMenuMealSheet } from '@/lib/nutriscore-persist';
import type { RecipeIngredient } from '@/data/recipes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PATCH /api/admin/menus/[id]/meal-sheets/[sheetId]
 *
 * Met à jour une fiche repas d'un menu hebdomadaire. Utilisé par la page
 * admin Nutri-Score quand Karine complète quantités / lie des ingrédients
 * à Ciqual sur une recette de menu.
 *
 * Body : { ingredients: RecipeIngredient[] }
 *
 * Persistance : on remplace la jsonb `ingredients`, puis on déclenche
 * persistNutriscoreForMenuMealSheet pour recalculer + stocker le grade.
 */
function sanitize(it: any): RecipeIngredient {
  return {
    category: typeof it?.category === 'string' ? it.category.trim() : '',
    label: typeof it?.label === 'string' ? it.label.trim() : '',
    quantity:
      typeof it?.quantity === 'number' && Number.isFinite(it.quantity)
        ? it.quantity
        : null,
    unit: typeof it?.unit === 'string' ? it.unit.trim() || null : null,
    note: typeof it?.note === 'string' ? it.note.trim() || null : null,
    ciqual_food_id:
      typeof it?.ciqual_food_id === 'number' &&
      Number.isFinite(it.ciqual_food_id)
        ? it.ciqual_food_id
        : null,
  };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; sheetId: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { sheetId } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || !Array.isArray(body.ingredients)) {
    return NextResponse.json(
      { error: 'Body { ingredients: [...] } attendu.' },
      { status: 400 },
    );
  }

  const ingredients = (body.ingredients as any[])
    .map(sanitize)
    .filter((i) => i.category && i.label);

  const supabase = createServiceClient() as any;
  const { error } = await supabase
    .from('menu_meal_sheets')
    .update({ ingredients })
    .eq('id', sheetId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await persistNutriscoreForMenuMealSheet(sheetId);

  return NextResponse.json({ ok: true, count: ingredients.length });
}
