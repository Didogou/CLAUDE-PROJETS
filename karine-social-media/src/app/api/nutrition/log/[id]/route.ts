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
 * Met à jour la catégorie de repas (meal_category) d'une entrée.
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
  if (!MEAL_CATEGORIES.includes(meal)) {
    return NextResponse.json({ error: 'mealCategory invalide' }, { status: 400 });
  }

  const { error } = await (supabase as any)
    .from('food_log_entries')
    .update({ meal_category: meal })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
