import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { WeeklyMenu, WeeklyMenuDay } from '@/data/menus';

function isMissingTable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '42P01'
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMenu(row: any, days: any[]): WeeklyMenu {
  return {
    id: row.id,
    weekStart: row.week_start,
    title: row.title,
    coverImageUrl: row.cover_image_url ?? '',
    shoppingListImageUrl: row.shopping_list_image_url ?? '',
    status: row.status,
    publishedAt: row.published_at,
    days: days
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any): WeeklyMenuDay => ({
        dayIndex: d.day_index,
        coverImageUrl: d.cover_image_url,
        lunchLabel: d.lunch_label ?? '',
        lunchRecipeSlug: d.lunch_recipe_slug,
        lunchImageUrl: d.lunch_image_url,
        dinnerLabel: d.dinner_label ?? '',
        dinnerRecipeSlug: d.dinner_recipe_slug,
        dinnerImageUrl: d.dinner_image_url,
        prepPhotos: d.prep_photos ?? [],
      }))
      .sort((a, b) => a.dayIndex - b.dayIndex),
  };
}

// Public : liste des menus publiés, du plus récent au plus ancien
export async function getPublishedMenus(): Promise<WeeklyMenu[]> {
  const supabase = createServiceClient();
  const { data: menus, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('weekly_menus' as any)
    .select('*')
    .eq('status', 'published')
    .order('week_start', { ascending: false })
    .limit(100);
  if (error) {
    if (isMissingTable(error)) {
      console.warn('[menus] tables absentes — migration 20260530240100_weekly_menus.sql à appliquer');
      return [];
    }
    throw error;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const menuRows = (menus ?? []) as any[];
  if (menuRows.length === 0) return [];

  const { data: days, error: dErr } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('weekly_menu_days' as any)
    .select('*')
    .in('menu_id', menuRows.map((m) => m.id));
  if (dErr) throw dErr;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dayRows = (days ?? []) as any[];

  return menuRows.map((m) => mapMenu(m, dayRows.filter((d) => d.menu_id === m.id)));
}

// Public : un menu publié par id
export async function getPublishedMenuById(id: string): Promise<WeeklyMenu | null> {
  const supabase = createServiceClient();
  const { data: menu, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('weekly_menus' as any)
    .select('*')
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!menu) return null;
  const { data: days } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('weekly_menu_days' as any)
    .select('*')
    .eq('menu_id', (menu as unknown as { id: string }).id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapMenu(menu, (days ?? []) as any[]);
}

// Admin : tous les menus (draft + published)
export async function getAllMenusAdmin(): Promise<WeeklyMenu[]> {
  const supabase = createServiceClient();
  const { data: menus, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('weekly_menus' as any)
    .select('*')
    .order('week_start', { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingTable(error)) {
      console.warn('[menus] tables absentes — migration 20260530240100_weekly_menus.sql à appliquer');
      return [];
    }
    throw error;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const menuRows = (menus ?? []) as any[];
  if (menuRows.length === 0) return [];

  const { data: days } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('weekly_menu_days' as any)
    .select('*')
    .in('menu_id', menuRows.map((m) => m.id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dayRows = (days ?? []) as any[];

  return menuRows.map((m) => mapMenu(m, dayRows.filter((d) => d.menu_id === m.id)));
}

export async function getMenuAdminById(id: string): Promise<WeeklyMenu | null> {
  const supabase = createServiceClient();
  const { data: menu, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('weekly_menus' as any)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!menu) return null;
  const { data: days } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('weekly_menu_days' as any)
    .select('*')
    .eq('menu_id', (menu as unknown as { id: string }).id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapMenu(menu, (days ?? []) as any[]);
}
