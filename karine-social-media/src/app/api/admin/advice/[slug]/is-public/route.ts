import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * PATCH /api/admin/advice/:slug/is-public — Body : { isPublic: boolean }
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
  // Table réelle des conseils santé = `health_advice` (cf. lib/advice.ts,
  // route [slug]/route.ts). `advice` est la table legacy sans colonne slug.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('health_advice')
    .update({ is_public: isPublic })
    .eq('slug', slug);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, isPublic });
}
