import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// V1 anonyme : on incrémente le compteur sans vérifier l'identité.
// Rate-limiting basique côté client via localStorage (pas robuste mais limite le spam).
// V2 : passera par une table recipe_likes(user_id, recipe_id) quand les abonnés
// auront un compte, avec contrainte unique pour empêcher les doubles likes.

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await ctx.params;
    const supabase = createServiceClient();

    // increment atomique via RPC ou via select+update. Pas de RPC ici → on fait
    // une lecture puis update. Course possible mais V1 acceptable.
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
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/recipes/[slug]/like — décrémente le compteur (clamp à 0).
 * V1 anonyme : le client est responsable de ne décrémenter qu'après
 * avoir liké (cf. localStorage karine.liked-recipes.v1).
 */
export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
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
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
