/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/shopping-list/reset
 *
 * Vide la liste de courses active de l'utilisatrice :
 *   - items = []
 *   - linked_recipes = []
 *   - linked_menu_id = null
 *
 * La liste reste en status 'active' (on ne l'archive pas) — c'est juste
 * un "clear" pour repartir de zéro. Pratique quand la liste est polluée
 * de références cassées ou qu'on veut un nouveau cycle de courses.
 */
export async function POST() {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;

  const supabase = createServiceClient() as any;

  // Trouve la liste active de l'utilisatrice
  const { data: activeList, error: selectErr } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (selectErr) {
    return NextResponse.json({ error: selectErr.message }, { status: 500 });
  }
  if (!activeList) {
    return NextResponse.json(
      { error: 'Aucune liste active à réinitialiser' },
      { status: 404 },
    );
  }

  // Reset : vide items + linked_recipes + linked_menu_id
  const { error: updErr } = await supabase
    .from('shopping_lists')
    .update({
      items: [],
      linked_recipes: [],
      linked_menu_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', activeList.id)
    .eq('user_id', auth.user.id); // double check ownership

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
