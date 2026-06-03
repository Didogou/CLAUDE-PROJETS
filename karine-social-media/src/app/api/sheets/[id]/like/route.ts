import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/sheets/[id]/like — toggle le like de la fiche par l'user.
 * Anti double-like via PK composite (user_id, sheet_id).
 * Renvoie { liked, likesCount }.
 */
export async function POST(
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
  try {
    const { id: sheetId } = await ctx.params;
    if (!sheetId) {
      return NextResponse.json({ error: 'sheetId requis' }, { status: 400 });
    }

    // Vérifie si l'user a déjà liké
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any)
      .from('sheet_likes')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('sheet_id', sheetId)
      .maybeSingle();

    let liked: boolean;
    if (existing) {
      // Déjà liké → on retire
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('sheet_likes')
        .delete()
        .eq('user_id', user.id)
        .eq('sheet_id', sheetId);
      if (error) throw error;
      liked = false;
    } else {
      // Pas liké → on insère
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('sheet_likes')
        .insert({ user_id: user.id, sheet_id: sheetId });
      if (error) throw error;
      liked = true;
    }

    // Récupère le compteur à jour (trigger l'a mis à jour)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sheet } = await (supabase as any)
      .from('recipe_sheets')
      .select('likes_count')
      .eq('id', sheetId)
      .maybeSingle();
    const likesCount =
      typeof sheet?.likes_count === 'number' ? sheet.likes_count : 0;

    return NextResponse.json({ liked, likesCount });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
