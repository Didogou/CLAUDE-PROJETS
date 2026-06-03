import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Pour un user donné et une liste de sheet IDs, retourne un Set des
 * sheet IDs likées par l'user. Utilisé pour hydrater l'état initial
 * du SheetCarousel côté serveur.
 *
 * Retourne un Set vide si user non connecté ou aucune liste fournie.
 */
export async function getUserLikedSheetIds(
  userId: string | null,
  sheetIds: string[],
): Promise<Set<string>> {
  if (!userId || sheetIds.length === 0) return new Set();
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('sheet_likes')
      .select('sheet_id')
      .eq('user_id', userId)
      .in('sheet_id', sheetIds);
    if (error) {
      // Table pas encore créée (migration pas tournée) → empty set
      if ((error as { code?: string }).code === '42P01') return new Set();
      throw error;
    }
    return new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data ?? []).map((row: any) => String(row.sheet_id)),
    );
  } catch {
    return new Set();
  }
}

/** Récupère TOUS les sheet IDs que l'user a likés (pour page profil / favoris). */
export async function getAllUserLikedSheetIds(
  userId: string,
): Promise<string[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('sheet_likes')
      .select('sheet_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      if ((error as { code?: string }).code === '42P01') return [];
      throw error;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((row: any) => String(row.sheet_id));
  } catch {
    return [];
  }
}
