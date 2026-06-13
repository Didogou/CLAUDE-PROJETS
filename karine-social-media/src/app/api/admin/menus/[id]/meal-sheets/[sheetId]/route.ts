import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { persistNutriscoreForMenuMealSheet } from '@/lib/nutriscore-persist';
import { sanitizePreparationSteps } from '@/lib/utensils';
import type { RecipeIngredient } from '@/data/recipes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PATCH /api/admin/menus/[id]/meal-sheets/[sheetId]
 *
 * Met à jour une fiche repas d'un menu — édition CHAMP PAR CHAMP (parité
 * recettes). Body PARTIEL : on n'écrit que les colonnes fournies parmi
 * title, servings, calories, proteins_g, lipids_g, carbs_g, prep_time_min,
 * cook_time_min, tags, aliments, ingredients, preparation_steps, utensils.
 *
 * Si ingredients OU servings changent → recompute + persist du Nutri-Score
 * (renvoyé dans la réponse pour rafraîchir la vignette).
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
    // Clé canonique = alim_code STABLE ; ciqual_food_id deprecated.
    ciqual_alim_code:
      typeof it?.ciqual_alim_code === 'number' &&
      Number.isFinite(it.ciqual_alim_code)
        ? it.ciqual_alim_code
        : null,
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
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body JSON attendu.' }, { status: 400 });
  }

  // Whitelist : on ne met à jour QUE les colonnes fournies (patch partiel).
  const update: Record<string, any> = {};
  const strOrNull = (v: any) =>
    typeof v === 'string' ? v.trim() || null : v === null ? null : undefined;
  const numOrNull = (v: any) =>
    typeof v === 'number' && Number.isFinite(v) ? v : v === null ? null : undefined;
  const strArray = (v: any) =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string') : undefined;

  if ('title' in body) {
    const t = strOrNull(body.title);
    if (t !== undefined) update.title = t;
  }
  for (const [bodyKey, col] of [
    ['servings', 'servings'],
    ['calories', 'calories'],
    ['proteins_g', 'proteins_g'],
    ['lipids_g', 'lipids_g'],
    ['carbs_g', 'carbs_g'],
    ['prep_time_min', 'prep_time_min'],
    ['cook_time_min', 'cook_time_min'],
  ] as const) {
    if (bodyKey in body) {
      const n = numOrNull(body[bodyKey]);
      if (n !== undefined) update[col] = n;
    }
  }
  if ('tags' in body) {
    const a = strArray(body.tags);
    if (a) update.tags = a;
  }
  if ('aliments' in body) {
    const a = strArray(body.aliments);
    if (a) update.aliments = a;
  }
  if ('utensils' in body) {
    const a = strArray(body.utensils);
    if (a) update.utensils = a;
  }
  // Overrides diététiques (parité recettes) : boolean ou null (= auto).
  const boolOrNull = (v: any) =>
    typeof v === 'boolean' ? v : v === null ? null : undefined;
  for (const col of [
    'is_vegetarian_override',
    'is_gluten_free_override',
    'is_pork_free_override',
  ] as const) {
    if (col in body) {
      const b = boolOrNull(body[col]);
      if (b !== undefined) update[col] = b;
    }
  }
  if ('preparation_steps' in body) {
    update.preparation_steps = sanitizePreparationSteps(body.preparation_steps);
  }
  const ingredientsProvided = Array.isArray(body.ingredients);
  if (ingredientsProvided) {
    update.ingredients = (body.ingredients as any[])
      .map(sanitize)
      .filter((i) => i.category && i.label);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour.' }, { status: 400 });
  }

  const supabase = createServiceClient() as any;
  const { error } = await supabase
    .from('menu_meal_sheets')
    .update(update)
    .eq('id', sheetId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Recompute Nutri-Score si la nutrition a pu changer (ingrédients / portions).
  let nutriscore: { grade: string | null; confidence: number | null } | null = null;
  if (ingredientsProvided || 'servings' in update) {
    await persistNutriscoreForMenuMealSheet(sheetId);
    const { data } = await supabase
      .from('menu_meal_sheets')
      .select('nutriscore_grade, nutriscore_confidence')
      .eq('id', sheetId)
      .maybeSingle();
    nutriscore = {
      grade: data?.nutriscore_grade ?? null,
      confidence:
        data?.nutriscore_confidence == null ? null : Number(data.nutriscore_confidence),
    };
  }

  return NextResponse.json({ ok: true, nutriscore });
}
