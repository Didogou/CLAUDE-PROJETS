import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { revalidateMenus } from '@/lib/cached-content';
import type { ShoppingListItem } from '@/data/menus';

const BUCKET = 'content-images';

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

    // Liste de courses extraite par Vision DANS la page création
    // (le composant ShoppingListEditor a déjà uploadé l'image en temp
    // via /shopping-list/preview et nous transmet le résultat à valider).
    const shoppingTempPath = String(form.get('shopping_list_temp_path') || '').trim() || null;
    const shoppingPortionsRaw = String(form.get('shopping_list_portions') || '').trim();
    const shoppingPortions =
      shoppingPortionsRaw && Number.isFinite(Number(shoppingPortionsRaw))
        ? Math.round(Number(shoppingPortionsRaw))
        : null;
    const shoppingItemsRaw = String(form.get('shopping_list_items') || '').trim();
    let shoppingItems: ShoppingListItem[] | null = null;
    if (shoppingItemsRaw) {
      try {
        const parsed = JSON.parse(shoppingItemsRaw);
        if (Array.isArray(parsed)) {
          shoppingItems = parsed.filter(
            (it: unknown): it is ShoppingListItem =>
              !!it &&
              typeof it === 'object' &&
              typeof (it as ShoppingListItem).category === 'string' &&
              typeof (it as ShoppingListItem).label === 'string',
          );
        }
      } catch {
        // JSON invalide → on ignore et on continue la création menu
      }
    }

    const supabase = createServiceClient();

    // 1. Insert menu (sans images — on ajoute juste les champs liste de
    //    courses si l'admin a déjà analysé une image dans le form)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertPayload: Record<string, any> = {
      week_start: weekStart,
      title,
      status,
      published_at: status === 'published' ? new Date().toISOString() : null,
    };
    if (shoppingPortions != null) insertPayload.shopping_list_portions = shoppingPortions;
    if (shoppingItems != null) insertPayload.shopping_list_items = shoppingItems;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: menu, error } = await (supabase.from('weekly_menus' as any) as any)
      .insert(insertPayload)
      .select()
      .single();
    if (error) throw error;

    // 2. Move l'image temp → emplacement définitif rattaché au menu
    //    Restreint au préfixe `temp-shopping/` pour empêcher de déplacer
    //    n'importe quel fichier du bucket vers menus/{id}/.
    if (shoppingTempPath && shoppingTempPath.startsWith('temp-shopping/')) {
      const finalPath = `menus/${menu.id}/shopping-${Date.now().toString(36)}.webp`;
      const { error: moveErr } = await supabase.storage
        .from(BUCKET)
        .move(shoppingTempPath, finalPath);
      if (!moveErr) {
        const finalUrl = supabase.storage.from(BUCKET).getPublicUrl(finalPath).data.publicUrl;
        await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from('weekly_menus' as any)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ shopping_list_image_url: finalUrl } as any)
          .eq('id', menu.id);
      } else {
        // move a échoué (fichier déjà déplacé / disparu) — on log mais on
        // ne fait pas planter la création du menu.
        console.warn('[admin/menus POST] move temp shopping failed:', moveErr);
      }
    }

    // 3. Insert 7 days sans images
    const dayInserts = days.map((d) => ({ ...d, menu_id: menu.id }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dErr } = await (supabase.from('weekly_menu_days' as any) as any).insert(dayInserts);
    if (dErr) throw dErr;

    revalidateMenus();
    return NextResponse.json({ ok: true, id: menu.id });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
