import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';

// V1 anonyme : pas d'auth (les visiteurs peuvent liker).
// Rate-limit par IP 20/min : suffit pour un usage humain légitime
// (cliquer 10-15 likes en parcourant /recettes) mais bloque le vandalisme
// automatisé (curl en boucle qui pétait les compteurs avant 2026-06-12).
// V2 : table recipe_likes(user_id, recipe_id) avec contrainte unique.

const RATE = { windowMs: 60_000, max: 20 };

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const rl = checkRateLimit({ req: request, key: 'like-recipe', ...RATE });
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.error },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }
  try {
    const { slug } = await ctx.params;
    const supabase = createServiceClient();
    const { data: current, error: readErr } = await supabase
      .from('recipes')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('likes_count' as any)
      .eq('slug', slug)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 });

    const prev = (current as { likes_count?: number | null }).likes_count ?? 0;
    const next = prev + 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await supabase
      .from('recipes')
      .update({ likes_count: next } as any)
      .eq('slug', slug);
    if (upErr) throw upErr;

    return NextResponse.json({ likes: next });
  } catch (e) {
    console.error('[recipes/like POST]', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/**
 * DELETE /api/recipes/[slug]/like — décrémente le compteur (clamp à 0).
 */
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const rl = checkRateLimit({ req: request, key: 'like-recipe', ...RATE });
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.error },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }
  try {
    const { slug } = await ctx.params;
    const supabase = createServiceClient();
    const { data: current, error: readErr } = await supabase
      .from('recipes')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('likes_count' as any)
      .eq('slug', slug)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 });

    const prev = (current as { likes_count?: number | null }).likes_count ?? 0;
    const next = Math.max(0, prev - 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await supabase
      .from('recipes')
      .update({ likes_count: next } as any)
      .eq('slug', slug);
    if (upErr) throw upErr;

    return NextResponse.json({ likes: next });
  } catch (e) {
    console.error('[recipes/like DELETE]', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
