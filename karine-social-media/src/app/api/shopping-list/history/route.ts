import { NextResponse } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import { getArchivedLists } from '@/lib/shopping-lists';

/** GET /api/shopping-list/history — listes archivées de l'user (50 max). */
export async function GET() {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const lists = await getArchivedLists(auth.user.id);
    return NextResponse.json({ lists });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
