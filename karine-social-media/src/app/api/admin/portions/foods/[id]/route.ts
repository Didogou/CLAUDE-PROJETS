import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';
import { invalidatePortionCache } from '@/lib/portion-rules';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body?.name === 'string')
    update.name = body.name.trim().toLowerCase();
  if (typeof body?.portionG === 'number' && Number.isFinite(body.portionG)) {
    const v = Math.round(body.portionG);
    if (v < 1 || v > 10000) {
      return NextResponse.json(
        { error: 'portionG hors bornes (1..10000)' },
        { status: 400 },
      );
    }
    update.portion_g = v;
  }
  if (
    body?.sizeVariability === 'low' ||
    body?.sizeVariability === 'medium' ||
    body?.sizeVariability === 'high'
  ) {
    update.size_variability = body.sizeVariability;
  }
  if (typeof body?.notes === 'string') {
    update.notes = body.notes.trim() || null;
  }
  const supabase = createServiceClient();
  const { error } = await (supabase as any)
    .from('portion_foods')
    .update(update)
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  invalidatePortionCache();
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const { error } = await (supabase as any)
    .from('portion_foods')
    .delete()
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  invalidatePortionCache();
  return NextResponse.json({ ok: true });
}
