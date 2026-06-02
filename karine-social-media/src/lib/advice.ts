import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { Advice, AdviceStatus } from '@/data/advice';

type AdviceRow = {
  id: number;
  slug: string;
  label: string;
  slides: string[] | null;
  tags: string[] | null;
  likes_count: number | null;
  status: AdviceStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: AdviceRow): Advice {
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

export async function getPublishedAdvice(): Promise<Advice[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('health_advice')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) {
    console.warn('[advice] getPublished', error);
    return [];
  }
  return ((data ?? []) as AdviceRow[]).map(mapRow);
}

export async function getAllAdviceAdmin(): Promise<Advice[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('health_advice')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as AdviceRow[]).map(mapRow);
}

export async function getAdviceBySlug(slug: string): Promise<Advice | null> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('health_advice')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as AdviceRow) : null;
}
