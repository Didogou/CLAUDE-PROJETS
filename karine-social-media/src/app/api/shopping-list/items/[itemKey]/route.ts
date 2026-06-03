import { NextResponse, type NextRequest } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import { toggleItemChecked, removeItem } from '@/lib/shopping-lists';

/** PATCH /api/shopping-list/items/[itemKey] — toggle l'état coché. */
export async function PATCH(
  _request: NextRequest,
  ctx: { params: Promise<{ itemKey: string }> },
) {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const { itemKey } = await ctx.params;
    const decoded = decodeURIComponent(itemKey);
    const list = await toggleItemChecked(auth.user.id, decoded);
    return NextResponse.json({ list });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/shopping-list/items/[itemKey] — supprime un article. */
export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ itemKey: string }> },
) {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const { itemKey } = await ctx.params;
    const decoded = decodeURIComponent(itemKey);
    const list = await removeItem(auth.user.id, decoded);
    return NextResponse.json({ list });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
