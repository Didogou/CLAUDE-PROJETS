import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * PATCH /api/admin/tips/:slug/is-public — Body : { isPublic: boolean }
 *
 * Toggle visibilité publique d'une astuce. Source unique de vérité,
 * pas exposé dans la page d'édition (granularité par la liste).
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: 'slug manquant' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const isPublic = body?.isPublic;
  if (typeof isPublic !== 'boolean') {
    return NextResponse.json({ error: 'isPublic boolean requis' }, { status: 400 });
  }

  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('tips')
    .update({ is_public: isPublic })
    .eq('slug', slug);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, isPublic });
}
