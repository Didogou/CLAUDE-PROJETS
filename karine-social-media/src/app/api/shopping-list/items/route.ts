import { NextResponse, type NextRequest } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import { addManualItem } from '@/lib/shopping-lists';

/**
 * POST /api/shopping-list/items — ajoute un article manuel.
 * Body : { category, label, quantity?, unit?, note? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const category =
      typeof body?.category === 'string' ? body.category.trim() : 'Divers';
    const label = typeof body?.label === 'string' ? body.label.trim() : '';
    if (!label) {
      return NextResponse.json({ error: 'label requis' }, { status: 400 });
    }
    const quantity =
      typeof body?.quantity === 'number' && Number.isFinite(body.quantity)
        ? body.quantity
        : null;
    const unit = typeof body?.unit === 'string' ? body.unit.trim() || null : null;
    const note = typeof body?.note === 'string' ? body.note.trim() || null : null;
    const list = await addManualItem(auth.user.id, {
      category,
      label,
      quantity,
      unit,
      note,
    });
    return NextResponse.json({ list });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
