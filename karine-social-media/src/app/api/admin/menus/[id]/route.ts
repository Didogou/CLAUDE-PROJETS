import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

const BUCKET = 'content-images';

/**
 * PATCH /api/admin/menus/[id] — TEXT ONLY (pas d'image dans le body).
 * Les images sont uploadées via PUT /api/admin/menus/[id]/asset (un fichier
 * par requête) pour éviter le 413 de Vercel.
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const form = await request.formData();
    const weekStart = String(form.get('weekStart') || '').trim();
    const title = String(form.get('title') || '').trim() || null;
    const status = String(form.get('status') || 'draft');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart))
      return NextResponse.json({ error: 'Date de lundi invalide' }, { status: 400 });

    const days = Array.from({ length: 7 }).map((_, i) => ({
      day_index: i,
      lunch_label: String(form.get(`lunch_label_${i}`) || '').trim(),
      lunch_recipe_slug: (String(form.get(`lunch_recipe_${i}`) || '').trim() || null) as string | null,
      dinner_label: String(form.get(`dinner_label_${i}`) || '').trim(),
      dinner_recipe_slug: (String(form.get(`dinner_recipe_${i}`) || '').trim() || null) as string | null,
    }));

    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current } = await (supabase.from('weekly_menus' as any) as any)
      .select('status, published_at')
      .eq('id', id)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: 'Menu introuvable' }, { status: 404 });

    const update: Record<string, unknown> = {
      week_start: weekStart,
      title,
      status,
      updated_at: new Date().toISOString(),
    };
    if (status === 'published' && current.status !== 'published') {
      update.published_at = new Date().toISOString();
    } else if (status !== 'published' && current.status === 'published') {
      update.published_at = null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase.from('weekly_menus' as any) as any)
      .update(update)
      .eq('id', id);
    if (upErr) throw upErr;

    // Lire l'existant pour conserver les images
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingDays } = await (supabase.from('weekly_menu_days' as any) as any)
      .select('*')
      .eq('menu_id', id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingByDay = new Map<number, any>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((existingDays ?? []) as any[]).map((d) => [d.day_index, d]),
    );

    // Delete + insert : on conserve les URLs d'images existantes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dDel } = await (supabase.from('weekly_menu_days' as any) as any)
      .delete()
      .eq('menu_id', id);
    if (dDel) throw dDel;

    const dayInserts = days.map((d) => {
      const prev = existingByDay.get(d.day_index);
      const row: Record<string, unknown> = {
        ...d,
        menu_id: id,
        cover_image_url: prev?.cover_image_url ?? null,
        lunch_image_url: prev?.lunch_image_url ?? null,
        dinner_image_url: prev?.dinner_image_url ?? null,
      };
      // Préserver prep_photos seulement si la colonne existe côté Cloud
      // (au cas où la migration ne soit pas encore appliquée).
      if (prev && 'prep_photos' in prev) {
        row.prep_photos = prev.prep_photos ?? [];
      }
      return row;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: iErr } = await (supabase.from('weekly_menu_days' as any) as any).insert(dayInserts);
    if (iErr) throw iErr;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin/menus PATCH/DELETE] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const supabase = createServiceClient();

    const { data: files } = await supabase.storage.from(BUCKET).list(`menus/${id}`);
    if (files && files.length > 0) {
      const paths = files.map((f) => `menus/${id}/${f.name}`);
      await supabase.storage.from(BUCKET).remove(paths);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('weekly_menus' as any) as any).delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin/menus PATCH/DELETE] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
