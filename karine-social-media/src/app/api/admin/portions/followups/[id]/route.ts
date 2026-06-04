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
  if (typeof body?.triggerKeyword === 'string')
    update.trigger_keyword = body.triggerKeyword.trim().toLowerCase();
  if (typeof body?.question === 'string') update.question = body.question.trim();
  if (typeof body?.suggestedFood === 'string')
    update.suggested_food = body.suggestedFood.trim().toLowerCase();
  if (typeof body?.defaultG === 'number' && Number.isFinite(body.defaultG)) {
    const v = Math.round(body.defaultG);
    if (v <= 0 || v > 1000) {
      return NextResponse.json(
        { error: 'defaultG hors bornes (1..1000)' },
        { status: 400 },
      );
    }
    update.default_g = v;
  }
  if (Array.isArray(body?.excludeKeywords)) {
    update.exclude_keywords = body.excludeKeywords
      .filter((k: unknown): k is string => typeof k === 'string')
      .map((k: string) => k.trim().toLowerCase())
      .filter(Boolean);
  }
  const supabase = createServiceClient();
  const { error } = await (supabase as any)
    .from('portion_followups')
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
    .from('portion_followups')
    .delete()
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidatePortionCache();
  return NextResponse.json({ ok: true });
}
