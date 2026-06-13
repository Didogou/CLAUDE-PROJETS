import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { getRecipeScoresBySlug } from '@/lib/menu-nutriscore';
import { parsePreparationSteps } from '@/data/recipes';
import type {
  WeeklyMenu,
  WeeklyMenuDay,
  ShoppingListItem,
  MenuMealSheet,
  MealKind,
} from '@/data/menus';

/** Récupère les scores des recettes référencées dans un tableau de
 *  jours (lunch + dinner). Retourne une Map slug → score utilisable
 *  par mapMenu. */
async function fetchScoresForDays(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dayRows: any[],
): Promise<Map<string, ScoreLite>> {
  const slugs = new Set<string>();
  for (const d of dayRows) {
    if (d.lunch_recipe_slug) slugs.add(d.lunch_recipe_slug);
    if (d.dinner_recipe_slug) slugs.add(d.dinner_recipe_slug);
  }
  const raw = await getRecipeScoresBySlug(Array.from(slugs));
  const out = new Map<string, ScoreLite>();
  for (const [slug, score] of raw) {
    out.set(slug, { grade: score.grade, confidence: score.confidence });
  }
  return out;
}

function isMissingTable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '42P01'
  );
}

type ScoreLite = { grade: 'A' | 'B' | 'C' | 'D' | 'E' | null; confidence: number | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMenu(row: any, days: any[], scoresMap?: Map<string, ScoreLite>): WeeklyMenu {
  const lookupGrade = (slug: string | null): 'A' | 'B' | 'C' | 'D' | 'E' | null => {
    if (!slug || !scoresMap) return null;
    const s = scoresMap.get(slug);
    if (!s || !s.grade) return null;
    if ((s.confidence ?? 0) < 0.5) return null;
    return s.grade;
  };
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
    isPublic: row.is_public ?? false,
    days: days
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any): WeeklyMenuDay => ({
        dayIndex: d.day_index,
        coverImageUrl: d.cover_image_url,
        lunchLabel: d.lunch_label ?? '',
        lunchRecipeSlug: d.lunch_recipe_slug,
        lunchImageUrl: d.lunch_image_url,
        lunchNutriscoreGrade: lookupGrade(d.lunch_recipe_slug),
        dinnerLabel: d.dinner_label ?? '',
        dinnerRecipeSlug: d.dinner_recipe_slug,
        dinnerImageUrl: d.dinner_image_url,
        dinnerNutriscoreGrade: lookupGrade(d.dinner_recipe_slug),
        prepPhotos: d.prep_photos ?? [],
      }))
      .sort((a, b) => a.dayIndex - b.dayIndex),
  };
}

/**
 * Version "lite" pour la PAGE LISTE /menus.
 *
 * SÉCURITÉ : avant ce helper, getPublishedMenus faisait select('*') qui
 * inclut `shopping_list_items` (jsonb avec tous les ingrédients pour
 * cuisiner les 7 jours). Tout était sérialisé dans le payload RSC
 * envoyé au navigateur — un non-abonné pouvait ouvrir DevTools et
 * récupérer la liste de courses de tous les menus.
 *
 * Cette version :
 *  - SELECT explicite EXCLUANT shopping_list_items et shopping_list_portions
 *  - mapMenu fait un Array.isArray(undefined) → [] → shoppingListItems=[]
 *  - les labels des jours (lunch_label, dinner_label) restent visibles —
 *    ce sont des intitulés courts, pas la recette
 */
export async function getPublishedMenusLite(): Promise<WeeklyMenu[]> {
  const supabase = createServiceClient();
  const { data: menus, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('weekly_menus' as any)
    .select(
      // PAS de "shopping_list_items" : la liste de courses détaillée
      // reste confidentielle tant qu'on n'a pas l'abonnement.
      'id, week_start, title, cover_image_url, shopping_list_image_url, status, published_at, is_public',
    )
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

  const scores = await fetchScoresForDays(dayRows);
  return menuRows.map((m) =>
    mapMenu(m, dayRows.filter((d) => d.menu_id === m.id), scores),
  );
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

  const scores = await fetchScoresForDays(dayRows);
  return menuRows.map((m) =>
    mapMenu(m, dayRows.filter((d) => d.menu_id === m.id), scores),
  );
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
  const dayRows = (days ?? []) as any[];
  const scores = await fetchScoresForDays(dayRows);
  return mapMenu(menu, dayRows, scores);
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

  const scores = await fetchScoresForDays(dayRows);
  return menuRows.map((m) =>
    mapMenu(m, dayRows.filter((d) => d.menu_id === m.id), scores),
  );
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
  const dayRows = (days ?? []) as any[];
  const scores = await fetchScoresForDays(dayRows);
  const result = mapMenu(menu, dayRows, scores);
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
          ciqual_alim_code:
            typeof it.ciqual_alim_code === 'number' ? it.ciqual_alim_code : null,
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
    preparationSteps: parsePreparationSteps(row.preparation_steps),
    utensils: Array.isArray(row.utensils)
      ? (row.utensils as unknown[]).filter(
          (s): s is string => typeof s === 'string',
        )
      : [],
    likesCount: typeof row.likes_count === 'number' ? row.likes_count : 0,
    nutriscoreGrade:
      row.nutriscore_grade === 'A' ||
      row.nutriscore_grade === 'B' ||
      row.nutriscore_grade === 'C' ||
      row.nutriscore_grade === 'D' ||
      row.nutriscore_grade === 'E'
        ? row.nutriscore_grade
        : null,
    nutriscoreConfidence:
      row.nutriscore_confidence === null || row.nutriscore_confidence === undefined
        ? null
        : Number(row.nutriscore_confidence),
    isVegetarianOverride:
      typeof row.is_vegetarian_override === 'boolean' ? row.is_vegetarian_override : null,
    isGlutenFreeOverride:
      typeof row.is_gluten_free_override === 'boolean' ? row.is_gluten_free_override : null,
    isPorkFreeOverride:
      typeof row.is_pork_free_override === 'boolean' ? row.is_pork_free_override : null,
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
