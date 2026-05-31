import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const form = await request.formData();
    const weekStart = String(form.get('weekStart') || '').trim();
    const title = String(form.get('title') || '').trim() || null;
    const status = String(form.get('status') || 'draft');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart))
      return NextResponse.json({ error: 'Date de lundi invalide (YYYY-MM-DD)' }, { status: 400 });

    const days = Array.from({ length: 7 }).map((_, i) => ({
      day_index: i,
      lunch_label: String(form.get(`lunch_label_${i}`) || '').trim(),
      lunch_recipe_slug: (String(form.get(`lunch_recipe_${i}`) || '').trim() || null) as string | null,
      dinner_label: String(form.get(`dinner_label_${i}`) || '').trim(),
      dinner_recipe_slug: (String(form.get(`dinner_recipe_${i}`) || '').trim() || null) as string | null,
    }));

    const supabase = createServiceClient();

    // 1. Insert menu sans images (les images seront uploadées en plusieurs PUT séparés)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: menu, error } = await (supabase.from('weekly_menus' as any) as any)
      .insert({
        week_start: weekStart,
        title,
        status,
        published_at: status === 'published' ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (error) throw error;

    // 2. Insert 7 days sans images
    const dayInserts = days.map((d) => ({ ...d, menu_id: menu.id }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dErr } = await (supabase.from('weekly_menu_days' as any) as any).insert(dayInserts);
    if (dErr) throw dErr;

    return NextResponse.json({ ok: true, id: menu.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
