import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const MEAL_CATEGORIES = ['breakfast', 'lunch', 'snack', 'dinner'] as const;

/**
 * DELETE /api/nutrition/log/:id
 * Supprime UNE entrée du journal de l'abonnée connectée.
 * RLS garantit qu'elle ne peut supprimer que ses propres entrées.
 */
export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id manquant' }, { status: 400 });
  }

  const { error } = await (supabase as any)
    .from('food_log_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/nutrition/log/:id
 * Met à jour partiellement une entrée :
 *  - mealCategory : 'breakfast' | 'lunch' | 'snack' | 'dinner'
 *  - kcal : number (0-5000) — total kcal de l'entrée. On set portions=1
 *    en parallèle pour que kcal × portions = kcal (pas de surprise).
 *
 * Tous les champs sont optionnels mais au moins un doit être fourni.
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id manquant' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const meal = body?.mealCategory;
  const kcal = body?.kcal;

  const update: Record<string, unknown> = {};
  if (meal !== undefined) {
    if (!MEAL_CATEGORIES.includes(meal)) {
      return NextResponse.json({ error: 'mealCategory invalide' }, { status: 400 });
    }
    update.meal_category = meal;
  }
  if (kcal !== undefined) {
    if (typeof kcal !== 'number' || !Number.isFinite(kcal) || kcal < 0 || kcal > 5000) {
      return NextResponse.json({ error: 'kcal hors bornes (0-5000)' }, { status: 400 });
    }
    update.kcal = kcal;
    update.portions = 1;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { error } = await (supabase as any)
    .from('food_log_entries')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
