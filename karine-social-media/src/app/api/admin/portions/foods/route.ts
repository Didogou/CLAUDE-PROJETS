import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';
import { invalidatePortionCache } from '@/lib/portion-rules';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET    /api/admin/portions/foods       liste tous les aliments
 * POST   /api/admin/portions/foods       cree un aliment
 *   body : { name, portionG, sizeVariability?, notes? }
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const supabase = createServiceClient();
  const { data, error } = await (supabase as any)
    .from('portion_foods')
    .select('id, name, portion_g, size_variability, notes, ai_generated, updated_at')
    .order('name', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ foods: data ?? [] });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim().toLowerCase() : '';
  const portionG =
    typeof body?.portionG === 'number' && Number.isFinite(body.portionG)
      ? Math.round(body.portionG)
      : null;
  const sizeVariability =
    body?.sizeVariability === 'low' ||
    body?.sizeVariability === 'medium' ||
    body?.sizeVariability === 'high'
      ? body.sizeVariability
      : 'medium';
  const notes = typeof body?.notes === 'string' ? body.notes.trim() || null : null;

  if (!name || portionG === null || portionG <= 0 || portionG > 10000) {
    return NextResponse.json(
      { error: 'name et portionG (1..10000) requis' },
      { status: 400 },
    );
  }
  const supabase = createServiceClient();
  const { data, error } = await (supabase as any)
    .from('portion_foods')
    .insert({
      name,
      portion_g: portionG,
      size_variability: sizeVariability,
      notes,
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  invalidatePortionCache();
  return NextResponse.json({ food: data });
}
