import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/meals/[id]/like
 *
 * V1 anonyme : incrémente likes_count sur menu_meal_sheets.
 * Garde-fou anti-spam côté client via localStorage (cf. RecipeCard).
 * V2 : table dédiée meal_sheet_likes(user_id, meal_sheet_id) avec
 * contrainte unique quand les abonnés auront un compte.
 */
export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id invalide' }, { status: 400 });
    }
    const supabase = createServiceClient();

    // Read + update (pas de RPC pour rester simple V1). Course possible.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current, error: readErr } = await (supabase as any)
      .from('menu_meal_sheets')
      .select('likes_count')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) {
      return NextResponse.json({ error: 'Repas introuvable' }, { status: 404 });
    }

    const prev = (current as { likes_count?: number | null }).likes_count ?? 0;
    const next = prev + 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('menu_meal_sheets')
      .update({ likes_count: next })
      .eq('id', id);
    if (upErr) throw upErr;

    return NextResponse.json({ likes: next });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/meals/[id]/like
 *
 * Décrémente likes_count (clamp à 0). V1 anonyme : le serveur ne
 * peut pas vérifier que c'est BIEN l'utilisateur qui avait liké
 * précédemment, on fait confiance au client (localStorage anti-spam).
 */
export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id invalide' }, { status: 400 });
    }
    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current, error: readErr } = await (supabase as any)
      .from('menu_meal_sheets')
      .select('likes_count')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) {
      return NextResponse.json({ error: 'Repas introuvable' }, { status: 404 });
    }

    const prev = (current as { likes_count?: number | null }).likes_count ?? 0;
    const next = Math.max(0, prev - 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('menu_meal_sheets')
      .update({ likes_count: next })
      .eq('id', id);
    if (upErr) throw upErr;

    return NextResponse.json({ likes: next });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
