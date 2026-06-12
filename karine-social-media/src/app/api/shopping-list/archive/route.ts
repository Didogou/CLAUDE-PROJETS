import { NextResponse, type NextRequest } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import { archiveActiveList } from '@/lib/shopping-lists';

/**
 * POST /api/shopping-list/archive
 * Body : { name? } (nom final optionnel, sinon on garde le nom courant)
 *
 * Archive la liste active et en crée une nouvelle vide pour l'user.
 * Renvoie la nouvelle liste active.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const finalName = typeof body?.name === 'string' ? body.name : undefined;
    const newList = await archiveActiveList(auth.user.id, finalName);
    return NextResponse.json({ list: newList });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
