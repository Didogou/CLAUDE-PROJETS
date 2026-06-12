import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';

// V1 anonyme + rate-limit IP 20/min (anti-vandalisme 2026-06-12).
const RATE = { windowMs: 60_000, max: 20 };

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const rl = checkRateLimit({ req: request, key: 'like-advice', ...RATE });
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.error },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }
  try {
    const { slug } = await ctx.params;
    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current, error: readErr } = await (supabase as any)
      .from('health_advice')
      .select('likes_count')
      .eq('slug', slug)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) return NextResponse.json({ error: 'Conseil introuvable' }, { status: 404 });

    const prev = (current as { likes_count?: number | null }).likes_count ?? 0;
    const next = prev + 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('health_advice')
      .update({ likes_count: next })
      .eq('slug', slug);
    if (upErr) throw upErr;

    return NextResponse.json({ likes: next });
  } catch (e) {
    console.error('[advice/like POST]', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const rl = checkRateLimit({ req: request, key: 'like-advice', ...RATE });
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.error },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }
  try {
    const { slug } = await ctx.params;
    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current, error: readErr } = await (supabase as any)
      .from('health_advice')
      .select('likes_count')
      .eq('slug', slug)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) return NextResponse.json({ error: 'Conseil introuvable' }, { status: 404 });

    const prev = (current as { likes_count?: number | null }).likes_count ?? 0;
    const next = Math.max(0, prev - 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('health_advice')
      .update({ likes_count: next })
      .eq('slug', slug);
    if (upErr) throw upErr;

    return NextResponse.json({ likes: next });
  } catch (e) {
    console.error('[advice/like DELETE]', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
