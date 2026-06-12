import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

export type Comment = {
  id: string;
  recipeSlug: string | null;
  tipSlug: string | null;
  authorName: string;
  body: string;
  photos: string[];
  likesCount: number;
  parentId: string | null;
  parentAuthor?: string; // résolu côté lib pour faciliter l'affichage "↳ @parent"
  status: 'visible' | 'hidden';
  createdAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Comment {
  return {
    id: row.id,
    recipeSlug: row.recipe_slug ?? null,
    tipSlug: row.tip_slug ?? null,
    authorName: row.author_name,
    body: row.body,
    photos: row.photos ?? [],
    likesCount: row.likes_count ?? 0,
    parentId: row.parent_id ?? null,
    status: row.status,
    createdAt: row.created_at,
  };
}

// Fallback silencieux si la table comments n'existe pas encore (migration pas appliquée).
// Code 42P01 = undefined_table. Tout autre code est re-thrown.
function isMissingTable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '42P01'
  );
}

export async function getVisibleCommentsForRecipe(slug: string): Promise<Comment[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('comments' as any)
    .select(
      'id, recipe_slug, tip_slug, author_name, body, photos, likes_count, parent_id, status, created_at',
    )
    .eq('recipe_slug', slug)
    .eq('status', 'visible')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    if (isMissingTable(error)) {
      console.warn('[comments] table absente — migration 20260530230000_comments.sql à appliquer');
      return [];
    }
    throw error;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comments = ((data ?? []) as any[]).map(mapRow);
  // Résoud le nom d'auteur du parent pour les réponses
  const byId = new Map(comments.map((c) => [c.id, c]));
  for (const c of comments) {
    if (c.parentId) {
      const parent = byId.get(c.parentId);
      if (parent) c.parentAuthor = parent.authorName;
    }
  }
  return comments;
}

export async function getVisibleCommentsForTip(slug: string): Promise<Comment[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('comments' as any)
    .select(
      'id, recipe_slug, tip_slug, author_name, body, photos, likes_count, parent_id, status, created_at',
    )
    .eq('tip_slug', slug)
    .eq('status', 'visible')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comments = ((data ?? []) as any[]).map(mapRow);
  const byId = new Map(comments.map((c) => [c.id, c]));
  for (const c of comments) {
    if (c.parentId) {
      const parent = byId.get(c.parentId);
      if (parent) c.parentAuthor = parent.authorName;
    }
  }
  return comments;
}

/**
 * Map slug → nombre d'avis visibles, en une seule requête.
 * Utile pour afficher le compteur sous chaque polaroid dans la grille.
 */
export async function getTipCommentCounts(slugs: string[]): Promise<Record<string, number>> {
  if (slugs.length === 0) return {};
  const supabase = createServiceClient();
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('comments' as any)
    .select('tip_slug')
    .in('tip_slug', slugs)
    .eq('status', 'visible');
  if (error) {
    if (isMissingTable(error)) return {};
    throw error;
  }
  const counts: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const k = row.tip_slug as string;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

// Admin : tous les avis tous statuts, tri récent → ancien
export async function getAllCommentsAdmin(): Promise<Comment[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('comments' as any)
    .select(
      'id, recipe_slug, tip_slug, author_name, body, photos, likes_count, parent_id, status, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingTable(error)) {
      console.warn('[comments] table absente — migration 20260530230000_comments.sql à appliquer');
      return [];
    }
    throw error;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRow);
}
