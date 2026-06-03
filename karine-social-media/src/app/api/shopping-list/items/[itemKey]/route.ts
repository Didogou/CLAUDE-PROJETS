import { NextResponse, type NextRequest } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import {
  toggleItemChecked,
  removeItem,
  setItemQuantity,
  setItemLabel,
} from '@/lib/shopping-lists';

/**
 * PATCH /api/shopping-list/items/[itemKey]
 *
 * Deux modes selon le body :
 *   - body vide ou { action: 'toggle' } → toggle l'état coché
 *   - body { quantity: number | null } → set la quantité manuellement
 *     (remplace les contributions par une contribution 'manual').
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ itemKey: string }> },
) {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const { itemKey } = await ctx.params;
    const decoded = decodeURIComponent(itemKey);
    const body = await request.json().catch(() => null);

    // Si label est explicitement présent → rename
    if (body && typeof body.label === 'string') {
      const list = await setItemLabel(auth.user.id, decoded, body.label);
      return NextResponse.json({ list });
    }

    // Si quantity est explicitement présent → set qty
    if (body && Object.prototype.hasOwnProperty.call(body, 'quantity')) {
      const q = body.quantity;
      const nextQty: number | null =
        q === null
          ? null
          : typeof q === 'number' && Number.isFinite(q) && q >= 0
            ? q
            : typeof q === 'string' && q.trim() !== '' && Number.isFinite(Number(q))
              ? Number(q)
              : null;
      const list = await setItemQuantity(auth.user.id, decoded, nextQty);
      return NextResponse.json({ list });
    }

    // Défaut : toggle checked
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
