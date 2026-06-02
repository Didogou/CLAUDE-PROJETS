import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { FeaturedPhoto } from '@/data/featured-photos';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): FeaturedPhoto {
  return {
    id: row.id,
    imageUrl: row.image_url,
    caption: row.caption,
    likesCount: row.likes_count ?? 0,
    sortOrder: row.sort_order ?? 0,
    published: !!row.published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Photos publiées affichées sur la home (visiteur + abonnés). */
export async function getPublishedFeaturedPhotos(): Promise<FeaturedPhoto[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('featured_photos')
    .select('*')
    .eq('published', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[featured-photos] getPublished', error);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRow);
}

/** Toutes les photos (publiées et brouillons) pour l'admin. */
export async function getAllFeaturedPhotosForAdmin(): Promise<FeaturedPhoto[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('featured_photos')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[featured-photos] getAllForAdmin', error);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRow);
}

export async function createFeaturedPhoto(args: {
  imageUrl: string;
  caption: string | null;
  adminId: string;
}): Promise<{ ok: true; photo: FeaturedPhoto } | { ok: false; reason: string }> {
  const supabase = createServiceClient();
  // Place la nouvelle photo en première position : sort_order = min - 10
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: minRow } = await (supabase as any)
    .from('featured_photos')
    .select('sort_order')
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((minRow?.sort_order as number | undefined) ?? 0) - 10;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('featured_photos')
    .insert({
      image_url: args.imageUrl,
      caption: args.caption,
      sort_order: nextOrder,
      published: true,
      created_by: args.adminId,
    })
    .select('*')
    .single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, photo: mapRow(data) };
}

export async function updateFeaturedPhoto(args: {
  id: number;
  patch: {
    caption?: string | null;
    published?: boolean;
    sortOrder?: number;
    likesCount?: number;
  };
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};
  if (args.patch.caption !== undefined) update.caption = args.patch.caption;
  if (args.patch.published !== undefined) update.published = args.patch.published;
  if (args.patch.sortOrder !== undefined) update.sort_order = args.patch.sortOrder;
  if (args.patch.likesCount !== undefined) update.likes_count = args.patch.likesCount;
  if (Object.keys(update).length === 0) return { ok: true };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('featured_photos')
    .update(update)
    .eq('id', args.id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function deleteFeaturedPhoto(
  id: number,
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('featured_photos')
    .delete()
    .eq('id', id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
