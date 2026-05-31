import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { Tip, TipStatus } from '@/data/tips';

// Types Supabase générés non encore au courant de la table `tips`.
type TipRow = {
  id: number;
  slug: string;
  label: string;
  slides: string[] | null;
  tags: string[] | null;
  likes_count: number | null;
  status: TipStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: TipRow): Tip {
  return {
    id: row.slug,
    label: row.label,
    slides: row.slides ?? [],
    tags: row.tags ?? [],
    likesCount: row.likes_count ?? 0,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

export async function getPublishedTips(): Promise<Tip[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('tips')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as TipRow[]).map(mapRow);
}

export async function getAllTipsAdmin(): Promise<Tip[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('tips')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as TipRow[]).map(mapRow);
}

export async function getTipBySlug(slug: string): Promise<Tip | null> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('tips')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as TipRow) : null;
}
