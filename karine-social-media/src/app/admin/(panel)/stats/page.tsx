/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServiceClient } from '@/lib/supabase/server';
import { StatsReport } from '@/components/admin/StatsReport';

export const dynamic = 'force-dynamic';

export type StatsRange = '7d' | '30d' | '90d' | 'all';

export type TopItem = {
  targetId: string;
  title: string;
  coverImage: string | null;
  total: number;
  bySubscribers: number;
  byPatients: number;
  byVisitors: number;
  byAnonymous: number;
  byAdmin: number;
};

export type DailyPoint = {
  date: string; // YYYY-MM-DD
  total: number;
};

export type StatsData = {
  range: StatsRange;
  totalViews: number;
  uniqueRecipes: number;
  uniqueMenus: number;
  uniqueUsers: number;
  anonymousViews: number;
  topRecipes: TopItem[];
  topMenus: TopItem[];
  daily: DailyPoint[];
  pageDistribution: Array<{ targetType: string; count: number }>;
};

const RANGE_DAYS: Record<StatsRange, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
};

/**
 * Page admin /admin/stats — rapport de trafic basé sur la table
 * page_views. Lecture seule.
 *
 * Filtres : période (7j / 30j / 90j / tout). Range défaut = 30 jours
 * (assez court pour rester rapide, assez long pour voir une tendance).
 */
export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const rangeRaw = (params.range as StatsRange) ?? '30d';
  const range: StatsRange = (['7d', '30d', '90d', 'all'] as StatsRange[]).includes(
    rangeRaw,
  )
    ? rangeRaw
    : '30d';

  const supa = createServiceClient() as any;

  // Filtre temporel
  const days = RANGE_DAYS[range];
  const sinceIso = days !== null
    ? new Date(Date.now() - days * 86_400_000).toISOString()
    : null;

  // Fetch toutes les vues sur la période. Pour Karine cette table sera
  // dans les ~100k rows max en croisière, donc on peut tout charger.
  // Si volume devient gros, on passera à des vues matérialisées.
  let queryViews = supa
    .from('page_views')
    .select('target_type, target_id, role_snapshot, user_id, viewed_at')
    .order('viewed_at', { ascending: false })
    .limit(50000);
  if (sinceIso) queryViews = queryViews.gte('viewed_at', sinceIso);
  const { data: viewsRaw } = await queryViews;
  const views = (viewsRaw ?? []) as Array<{
    target_type: string | null;
    target_id: string | null;
    role_snapshot: string | null;
    user_id: string | null;
    viewed_at: string;
  }>;

  const totalViews = views.length;
  const uniqueUsers = new Set(
    views.filter((v) => v.user_id).map((v) => v.user_id),
  ).size;
  const anonymousViews = views.filter((v) => !v.user_id).length;

  // Aggrégation par cible
  type Bucket = {
    total: number;
    bySubscribers: number;
    byPatients: number;
    byVisitors: number;
    byAnonymous: number;
    byAdmin: number;
  };
  const aggByTarget = (filterType: 'recipe' | 'menu') => {
    const acc = new Map<string, Bucket>();
    for (const v of views) {
      if (v.target_type !== filterType || !v.target_id) continue;
      let b = acc.get(v.target_id);
      if (!b) {
        b = {
          total: 0,
          bySubscribers: 0,
          byPatients: 0,
          byVisitors: 0,
          byAnonymous: 0,
          byAdmin: 0,
        };
        acc.set(v.target_id, b);
      }
      b.total++;
      switch (v.role_snapshot) {
        case 'admin':
          b.byAdmin++;
          break;
        case 'patient':
          b.byPatients++;
          break;
        case 'subscriber':
          b.bySubscribers++;
          break;
        case 'visitor':
          b.byVisitors++;
          break;
        default:
          b.byAnonymous++;
      }
    }
    return acc;
  };

  const recipeAgg = aggByTarget('recipe');
  const menuAgg = aggByTarget('menu');

  // Hydrate titres + covers
  const recipeIds = Array.from(recipeAgg.keys());
  const menuIds = Array.from(menuAgg.keys());

  const recipeTitles = new Map<string, { title: string; cover: string | null }>();
  if (recipeIds.length > 0) {
    const { data: r } = await supa
      .from('recipes')
      .select('slug, title, cover_image_url')
      .in('slug', recipeIds);
    for (const row of (r ?? []) as any[]) {
      recipeTitles.set(row.slug, {
        title: row.title,
        cover: row.cover_image_url ?? null,
      });
    }
  }

  const menuTitles = new Map<string, { title: string; cover: string | null }>();
  if (menuIds.length > 0) {
    const { data: m } = await supa
      .from('weekly_menus')
      .select('id, title, cover_image_url')
      .in('id', menuIds);
    for (const row of (m ?? []) as any[]) {
      menuTitles.set(row.id, {
        title: row.title ?? '(sans titre)',
        cover: row.cover_image_url ?? null,
      });
    }
  }

  const buildTop = (
    agg: Map<string, Bucket>,
    titles: Map<string, { title: string; cover: string | null }>,
  ): TopItem[] => {
    return Array.from(agg.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 20)
      .map(([targetId, b]) => {
        const meta = titles.get(targetId);
        return {
          targetId,
          title: meta?.title ?? `(${targetId})`,
          coverImage: meta?.cover ?? null,
          ...b,
        };
      });
  };

  const topRecipes = buildTop(recipeAgg, recipeTitles);
  const topMenus = buildTop(menuAgg, menuTitles);

  // Daily breakdown
  const dailyMap = new Map<string, number>();
  for (const v of views) {
    const d = v.viewed_at.slice(0, 10); // YYYY-MM-DD
    dailyMap.set(d, (dailyMap.get(d) ?? 0) + 1);
  }
  const daily: DailyPoint[] = Array.from(dailyMap.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Page distribution (recipe vs menu vs etc.)
  const typeCounter = new Map<string, number>();
  for (const v of views) {
    const key = v.target_type ?? '(non typé)';
    typeCounter.set(key, (typeCounter.get(key) ?? 0) + 1);
  }
  const pageDistribution = Array.from(typeCounter.entries())
    .map(([targetType, count]) => ({ targetType, count }))
    .sort((a, b) => b.count - a.count);

  const data: StatsData = {
    range,
    totalViews,
    uniqueRecipes: recipeAgg.size,
    uniqueMenus: menuAgg.size,
    uniqueUsers,
    anonymousViews,
    topRecipes,
    topMenus,
    daily,
    pageDistribution,
  };

  return <StatsReport data={data} />;
}
