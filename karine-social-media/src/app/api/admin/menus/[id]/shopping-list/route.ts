import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import type { ShoppingListItem } from '@/data/menus';

/**
 * Persiste la liste de courses validée par l'admin.
 * Body JSON : { portions: number | null, items: ShoppingListItem[] }
 *
 * On accepte aussi `items: []` pour "vider" la liste structurée tout en
 * gardant l'image source (cas où Karine veut retirer la liste cochable
 * et laisser uniquement l'image).
 */
export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
    }

    const portionsRaw = (body as { portions?: unknown }).portions;
    const itemsRaw = (body as { items?: unknown }).items;

    const portions: number | null =
      portionsRaw == null
        ? null
        : Number.isFinite(Number(portionsRaw)) && Number(portionsRaw) > 0
          ? Math.round(Number(portionsRaw))
          : null;

    if (!Array.isArray(itemsRaw)) {
      return NextResponse.json(
        { error: 'items doit être un tableau.' },
        { status: 400 },
      );
    }

    // Sanitize : on garde uniquement les items avec label et category non vides.
    const items: ShoppingListItem[] = [];
    for (const it of itemsRaw as unknown[]) {
      if (!it || typeof it !== 'object') continue;
      const obj = it as Record<string, unknown>;
      const category = typeof obj.category === 'string' ? obj.category.trim() : '';
      const label = typeof obj.label === 'string' ? obj.label.trim() : '';
      if (!category || !label) continue;
      const qty = obj.quantity;
      const qtyNum =
        typeof qty === 'number' && Number.isFinite(qty)
          ? qty
          : typeof qty === 'string' && qty.trim() !== '' && Number.isFinite(Number(qty))
            ? Number(qty)
            : null;
      const unit = typeof obj.unit === 'string' ? obj.unit.trim() || null : null;
      const note = typeof obj.note === 'string' ? obj.note.trim() || null : null;
      items.push({ category, label, quantity: qtyNum, unit, note });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('weekly_menus' as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        shopping_list_portions: portions,
        shopping_list_items: items,
      } as any)
      .eq('id', id);
    if (error) throw error;

    return NextResponse.json({ ok: true, portions, items });
  } catch (e) {
    console.error('[admin/menus shopping-list] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
