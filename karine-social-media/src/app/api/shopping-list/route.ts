import { NextResponse, type NextRequest } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import {
  getOrCreateActiveList,
  renameActiveList,
} from '@/lib/shopping-lists';

/** GET /api/shopping-list — récupère la liste active (en crée une si vide). */
export async function GET() {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const list = await getOrCreateActiveList(auth.user.id);
    return NextResponse.json({ list, householdSize: auth.user.householdSize });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/shopping-list — renomme la liste active. Body { name }. */
export async function PATCH(request: NextRequest) {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Nom requis' }, { status: 400 });
    }
    const list = await renameActiveList(auth.user.id, name);
    return NextResponse.json({ list });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
