import { NextResponse } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import { clearActiveList } from '@/lib/shopping-lists';

/**
 * POST /api/shopping-list/clear — vide entièrement la liste active
 * (items, recettes liées, menu lié). Garde la liste avec son nom.
 */
export async function POST() {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const list = await clearActiveList(auth.user.id);
    return NextResponse.json({ list });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
