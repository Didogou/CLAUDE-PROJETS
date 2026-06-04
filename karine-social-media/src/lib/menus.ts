import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type {
  WeeklyMenu,
  WeeklyMenuDay,
  ShoppingListItem,
  MenuMealSheet,
  MealKind,
} from '@/data/menus';

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
  // shopping_list_items en DB est jsonb : peut être null, [] ou un array
  // d'objets. On filtre les entrées malformées par sécurité.
  const rawItems = row.shopping_list_items;
  const items: ShoppingListItem[] | null = Array.isArray(rawItems)
    ? rawItems
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((it: any) => it && typeof it.label === 'string' && typeof it.category === 'string')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((it: any) => ({
          category: it.category,
          label: it.label,
          quantity: typeof it.quantity === 'number' ? it.quantity : null,
          unit: typeof it.unit === 'string' ? it.unit : null,
          note: typeof it.note === 'string' ? it.note : null,
        }))
    : null;
  return {
    id: row.id,
    weekStart: row.week_start,
    title: row.title,
    coverImageUrl: row.cover_image_url ?? '',
    shoppingListImageUrl: row.shopping_list_image_url ?? '',
    shoppingListPortions:
      typeof row.shopping_list_portions === 'number' ? row.shopping_list_portions : null,
    shoppingListItems: items,
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
  const result = mapMenu(menu, (days ?? []) as any[]);
  // Hydrate les meal sheets (admin a besoin pour l'éditeur)
  const sheetsMap = await getMenuMealSheets(result.id);
  const sheetsObj: Record<number, { lunch: MenuMealSheet | null; dinner: MenuMealSheet | null }> = {};
  for (const [k, v] of sheetsMap) sheetsObj[k] = v;
  return { ...result, mealSheets: sheetsObj };
}

// =============================================================
// Meal sheets (déjeuner / dîner) du menu
// =============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapMealSheet(row: any): MenuMealSheet {
  const rawIngredients = row.ingredients;
  const ingredients: ShoppingListItem[] = Array.isArray(rawIngredients)
    ? rawIngredients
        .filter((it: any) => it && typeof it.label === 'string' && typeof it.category === 'string')
        .map((it: any) => ({
          category: String(it.category),
          label: String(it.label),
          quantity: typeof it.quantity === 'number' ? it.quantity : null,
          unit: typeof it.unit === 'string' ? it.unit : null,
          note: typeof it.note === 'string' ? it.note : null,
        }))
    : [];
  return {
    id: String(row.id),
    menuId: String(row.menu_id),
    dayIndex: typeof row.day_index === 'number' ? row.day_index : 0,
    mealKind: row.meal_kind === 'dinner' ? 'dinner' : 'lunch',
    title: typeof row.title === 'string' ? row.title : null,
    coverImageUrl: row.cover_image_url ?? '',
    servings: typeof row.servings === 'number' ? row.servings : 4,
    calories: typeof row.calories === 'number' ? row.calories : null,
    proteinsG: row.proteins_g === null || row.proteins_g === undefined ? null : Number(row.proteins_g),
    lipidsG: row.lipids_g === null || row.lipids_g === undefined ? null : Number(row.lipids_g),
    carbsG: row.carbs_g === null || row.carbs_g === undefined ? null : Number(row.carbs_g),
    prepTimeMin: typeof row.prep_time_min === 'number' ? row.prep_time_min : null,
    cookTimeMin: typeof row.cook_time_min === 'number' ? row.cook_time_min : null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    aliments: Array.isArray(row.aliments) ? row.aliments : [],
    ingredients,
    likesCount: typeof row.likes_count === 'number' ? row.likes_count : 0,
  };
}

/**
 * Charge les meal sheets d'un menu. Renvoyé indexé par dayIndex
 * → { lunch, dinner } pour permettre un accès direct dans la page jour.
 *
 * Fallback gracieux si la table n'existe pas encore (migration 140000
 * pas tournée) → renvoie une map vide.
 */
export async function getMenuMealSheets(
  menuId: string,
): Promise<Map<number, { lunch: MenuMealSheet | null; dinner: MenuMealSheet | null }>> {
  const supabase = createServiceClient();
  const { data, error } = await (supabase as any)
    .from('menu_meal_sheets')
    .select('*')
    .eq('menu_id', menuId)
    .order('day_index', { ascending: true });
  const map = new Map<number, { lunch: MenuMealSheet | null; dinner: MenuMealSheet | null }>();
  if (error) {
    if (isMissingTable(error)) return map;
    throw error;
  }
  for (let i = 0; i < 7; i++) {
    map.set(i, { lunch: null, dinner: null });
  }
  for (const row of data ?? []) {
    const sheet = mapMealSheet(row);
    const slot = map.get(sheet.dayIndex) ?? { lunch: null, dinner: null };
    if (sheet.mealKind === 'lunch') slot.lunch = sheet;
    else slot.dinner = sheet;
    map.set(sheet.dayIndex, slot);
  }
  return map;
}

/** Résout une meal sheet par son id (pour l'API toggle-meal). */
export async function getMealSheetById(
  sheetId: string,
): Promise<MenuMealSheet | null> {
  const supabase = createServiceClient();
  const { data, error } = await (supabase as any)
    .from('menu_meal_sheets')
    .select('*')
    .eq('id', sheetId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!data) return null;
  return mapMealSheet(data);
}

/** Mute la signature inutilisée. */
export type _MealKindForward = MealKind;
