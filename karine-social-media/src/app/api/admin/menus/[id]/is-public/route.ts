import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * PATCH /api/admin/menus/:id/is-public
 *
 * Toggle rapide de la visibilité publique d'un menu hebdomadaire
 * ("Tout le monde"). Body JSON : { isPublic: boolean }.
 *
 * Utilisé par la liste admin pour basculer l'état sans entrer dans
 * la page d'édition (le toggle n'est pas exposé dans le formulaire
 * d'édition par choix : granularité uniquement par la liste).
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id manquant' }, { status: 400 });
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
  const { error } = await (supabase as unknown as {
    from: (
      table: string,
    ) => {
      update: (v: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{ error: Error | null }>;
      };
    };
  })
    .from('weekly_menus')
    .update({ is_public: isPublic })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, isPublic });
}
