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
  if (typeof body?.keyword === 'string')
    update.keyword = body.keyword.trim().toLowerCase();
  if (typeof body?.multiplier === 'number' && Number.isFinite(body.multiplier)) {
    const v = Math.round(body.multiplier * 100) / 100;
    if (v <= 0 || v > 10) {
      return NextResponse.json(
        { error: 'multiplier hors bornes (0..10)' },
        { status: 400 },
      );
    }
    update.multiplier = v;
  }
  const supabase = createServiceClient();
  const { error } = await (supabase as any)
    .from('portion_modifiers')
    .update(update)
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
    .from('portion_modifiers')
    .delete()
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidatePortionCache();
  return NextResponse.json({ ok: true });
}
