import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';

// V1 anonyme + rate-limit IP 20/min (anti-vandalisme 2026-06-12).
const RATE = { windowMs: 60_000, max: 20 };

/**
 * POST /api/meals/[id]/like — increment likes_count sur menu_meal_sheets.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const rl = checkRateLimit({ req: request, key: 'like-meal', ...RATE });
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.error },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }
  try {
    const { id } = await ctx.params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id invalide' }, { status: 400 });
    }
    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current, error: readErr } = await (supabase as any)
      .from('menu_meal_sheets')
      .select('likes_count')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) return NextResponse.json({ error: 'Repas introuvable' }, { status: 404 });

    const prev = (current as { likes_count?: number | null }).likes_count ?? 0;
    const next = prev + 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('menu_meal_sheets')
      .update({ likes_count: next })
      .eq('id', id);
    if (upErr) throw upErr;

    return NextResponse.json({ likes: next });
  } catch (e) {
    console.error('[meals/like POST]', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const rl = checkRateLimit({ req: request, key: 'like-meal', ...RATE });
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.error },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }
  try {
    const { id } = await ctx.params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id invalide' }, { status: 400 });
    }
    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current, error: readErr } = await (supabase as any)
      .from('menu_meal_sheets')
      .select('likes_count')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) return NextResponse.json({ error: 'Repas introuvable' }, { status: 404 });

    const prev = (current as { likes_count?: number | null }).likes_count ?? 0;
    const next = Math.max(0, prev - 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('menu_meal_sheets')
      .update({ likes_count: next })
      .eq('id', id);
    if (upErr) throw upErr;

    return NextResponse.json({ likes: next });
  } catch (e) {
    console.error('[meals/like DELETE]', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
