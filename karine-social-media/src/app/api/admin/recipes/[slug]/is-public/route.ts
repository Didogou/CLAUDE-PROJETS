import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * PATCH /api/admin/recipes/:slug/is-public
 *
 * Toggle rapide de la visibilité publique d'une recette ("Tout le
 * monde"). Body JSON : { isPublic: boolean }.
 *
 * Utilisé par la liste admin pour basculer l'état sans réenvoyer
 * tout le formulaire d'édition. La fiche détail utilise le PATCH
 * classique avec FormData (route parente).
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { slug } = await ctx.params;
  if (!slug) {
    return NextResponse.json({ error: 'slug manquant' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const isPublic = body?.isPublic;
  if (typeof isPublic !== 'boolean') {
    return NextResponse.json(
      { error: 'isPublic boolean requis' },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('recipes')
    .update({ is_public: isPublic })
    .eq('slug', slug);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, isPublic });
}
