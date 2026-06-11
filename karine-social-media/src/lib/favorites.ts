import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type {
  FavoriteItem,
  FavoriteRow,
  FavoriteType,
} from '@/data/favorites';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): FavoriteRow {
  return {
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  };
}

export async function getUserFavorites(userId: string): Promise<FavoriteRow[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('favorites')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[favorites] getUser', error);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRow);
}

export async function isFavorited(
  userId: string,
  targetType: FavoriteType,
  targetId: string,
): Promise<boolean> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('favorites')
    .select('user_id')
    .eq('user_id', userId)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

export async function addFavorite(
  userId: string,
  targetType: FavoriteType,
  targetId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('favorites')
    .insert({
      user_id: userId,
      target_type: targetType,
      target_id: targetId,
    });
  // Duplicate = déjà favorisé, considéré OK silencieusement
  if (error && error.code !== '23505') {
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

export async function removeFavorite(
  userId: string,
  targetType: FavoriteType,
  targetId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('favorites')
    .delete()
    .eq('user_id', userId)
    .eq('target_type', targetType)
    .eq('target_id', targetId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/**
 * Enrichit les favoris bruts avec leur label, image, href.
 * Fait une requête par type pour récupérer les méta-données.
 */
export async function enrichFavorites(
  rows: FavoriteRow[],
): Promise<FavoriteItem[]> {
  if (rows.length === 0) return [];
  const supabase = createServiceClient();

  const ids: Record<FavoriteType, string[]> = {
    recipe: [],
    menu: [],
    tip: [],
    advice: [],
    featured: [],
    meal_sheet: [],
  };
  for (const r of rows) ids[r.targetType].push(r.targetId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metaByKey = new Map<string, { label: string; imageUrl: string | null; href: string }>();

  // Recettes
  if (ids.recipe.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('recipes')
      .select('slug, title, cover_image_url')
      .in('slug', ids.recipe);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      metaByKey.set(`recipe:${r.slug}`, {
        label: r.title,
        imageUrl: r.cover_image_url ?? null,
        href: `/recettes/${r.slug}`,
      });
    }
  }

  // Menus
  if (ids.menu.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('menus')
      .select('id, title, cover_image_url')
      .in('id', ids.menu);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      metaByKey.set(`menu:${String(r.id)}`, {
        label: r.title ?? 'Menu',
        imageUrl: r.cover_image_url ?? null,
        href: `/menus/${r.id}`,
      });
    }
  }

  // Astuces (table tips)
  if (ids.tip.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('tips')
      .select('slug, label, slides')
      .in('slug', ids.tip);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      metaByKey.set(`tip:${r.slug}`, {
        label: r.label,
        imageUrl: (r.slides as string[] | null)?.[0] ?? null,
        href: `/astuces?open=${r.slug}`,
      });
    }
  }

  // Conseils (table health_advice)
  if (ids.advice.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('health_advice')
      .select('slug, label, slides')
      .in('slug', ids.advice);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      metaByKey.set(`advice:${r.slug}`, {
        label: r.label,
        imageUrl: (r.slides as string[] | null)?.[0] ?? null,
        href: `/conseils?open=${r.slug}`,
      });
    }
  }

  // Repas de menu (menu_meal_sheets) — id = uuid de la sheet de menu.
  // href pointe vers le menu parent avec le jour pré-sélectionné.
  if (ids.meal_sheet.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('menu_meal_sheets')
      .select('id, menu_id, title, cover_image_url, day_index, meal_kind')
      .in('id', ids.meal_sheet);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      metaByKey.set(`meal_sheet:${String(r.id)}`, {
        label: r.title ?? 'Repas de menu',
        imageUrl: r.cover_image_url ?? null,
        // Lien direct vers /jour (la racine /menus/[id] redirige
        // SANS préserver les query params). Le jour n'est pas pré-
        // sélectionné en V1 → l'utilisatrice navigue depuis la page.
        href: `/menus/${r.menu_id}/jour`,
      });
    }
  }

  // Le saviez-vous (table featured_photos) — id en chaîne
  if (ids.featured.length > 0) {
    const numIds = ids.featured.map((s) => Number(s)).filter((n) => Number.isFinite(n));
    if (numIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('featured_photos')
        .select('id, image_url, caption')
        .in('id', numIds);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (data ?? []) as any[]) {
        metaByKey.set(`featured:${String(r.id)}`, {
          label: r.caption ?? 'Le saviez-vous',
          imageUrl: r.image_url,
          href: `/?fav=${r.id}`,
        });
      }
    }
  }

  const items: FavoriteItem[] = [];
  for (const row of rows) {
    const meta = metaByKey.get(`${row.targetType}:${row.targetId}`);
    if (!meta) continue; // contenu supprimé entre temps
    items.push({
      targetType: row.targetType,
      targetId: row.targetId,
      label: meta.label,
      imageUrl: meta.imageUrl,
      href: meta.href,
      createdAt: row.createdAt,
    });
  }
  return items;
}
