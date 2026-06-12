import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PATCH /api/admin/utensils/[slug] — Body : { label?, imageUrl? }
 *
 * Édite une entrée du catalogue d'ustensiles. On NE change PAS le slug
 * (c'est la clé référencée par les fiches). label = libellé d'affichage,
 * imageUrl = image associée (étape « plus tard »).
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.label === 'string' && body.label.trim()) {
      patch.label = body.label.trim();
    }
    if (body.imageUrl !== undefined) {
      patch.image_url =
        typeof body.imageUrl === 'string' && body.imageUrl.trim()
          ? body.imageUrl.trim()
          : null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Rien à mettre à jour.' }, { status: 400 });
    }
    const supabase = createServiceClient();
    const { data, error } = await (supabase as any)
      .from('utensils')
      .update(patch)
      .eq('slug', slug)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, utensil: data });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/utensils/[slug] — retire l'entrée du catalogue.
 *
 * Les fiches qui référencent ce slug le gardent (slug orphelin) : il ne
 * résoudra simplement plus vers un label/image. Pas de cascade volontaire
 * pour éviter de toucher les fiches lors d'un nettoyage de catalogue.
 */
export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug } = await ctx.params;
    const supabase = createServiceClient();
    const { error } = await (supabase as any)
      .from('utensils')
      .delete()
      .eq('slug', slug);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
