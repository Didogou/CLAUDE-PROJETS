import { NextResponse, type NextRequest } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import { toggleMenuOnActiveList } from '@/lib/shopping-lists';
import { getPublishedMenuById } from '@/lib/menus';

/**
 * POST /api/shopping-list/toggle-menu
 * Body : { menuId }
 *
 * Toggle : ajoute/retire le menu hebdo à la liste. On utilise les items
 * de la shopping_list_items du menu (calibrée portions du menu), ratio
 * appliqué au household_size de l'user.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const menuId = typeof body?.menuId === 'string' ? body.menuId.trim() : '';
    if (!menuId) {
      return NextResponse.json({ error: 'menuId requis' }, { status: 400 });
    }
    const menu = await getPublishedMenuById(menuId);
    if (!menu) {
      return NextResponse.json({ error: 'Menu introuvable' }, { status: 404 });
    }
    const items = menu.shoppingListItems ?? [];
    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Ce menu n\'a pas de liste de courses structurée.' },
        { status: 409 },
      );
    }
    const list = await toggleMenuOnActiveList(
      auth.user.id,
      {
        id: menu.id,
        title: menu.title,
        portions: menu.shoppingListPortions ?? 4,
        items,
      },
      auth.user.householdSize,
    );
    return NextResponse.json({ list });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
