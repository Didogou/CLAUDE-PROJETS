import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import {
  type Recipe,
  type RecipeCategory,
  type RecipeIngredient,
  type RecipeSheet,
} from '@/data/recipes';
import type { Database } from '@/types/database';

type RecipeRow = Database['public']['Tables']['recipes']['Row'];

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapSheetRow(row: any): RecipeSheet {
  const rawIngredients = row.ingredients;
  const ingredients: RecipeIngredient[] = Array.isArray(rawIngredients)
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
    sheetIndex: typeof row.sheet_index === 'number' ? row.sheet_index : 0,
    title: typeof row.title === 'string' ? row.title : null,
    coverImageUrl: row.cover_image_url ?? '',
    servings: typeof row.servings === 'number' ? row.servings : 4,
    calories: typeof row.calories === 'number' ? row.calories : null,
    prepTimeMin: typeof row.prep_time_min === 'number' ? row.prep_time_min : null,
    cookTimeMin: typeof row.cook_time_min === 'number' ? row.cook_time_min : null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    aliments: Array.isArray(row.aliments) ? row.aliments : [],
    ingredients,
    ingredientsText:
      typeof row.ingredients_text === 'string' ? row.ingredients_text : null,
    likesCount: typeof row.likes_count === 'number' ? row.likes_count : 0,
    // Colonnes Nutri-Score persistées (migration 20260608120000).
    // Calculées par persistNutriscoreForSheet au save admin.
    nutriscoreGrade:
      row.nutriscore_grade === 'A' ||
      row.nutriscore_grade === 'B' ||
      row.nutriscore_grade === 'C' ||
      row.nutriscore_grade === 'D' ||
      row.nutriscore_grade === 'E'
        ? row.nutriscore_grade
        : null,
    nutriscoreConfidence:
      typeof row.nutriscore_confidence === 'number'
        ? row.nutriscore_confidence
        : row.nutriscore_confidence !== null && row.nutriscore_confidence !== undefined
          ? Number(row.nutriscore_confidence)
          : null,
  };
}

/** Construit l'objet Recipe à partir de la row recipe + ses sheets. */
function buildRecipe(row: RecipeRow, sheetRows: any[]): Recipe {
  const r = row as RecipeRow & {
    is_seasonal?: boolean | null;
    is_featured?: boolean | null;
    likes_count?: number | null;
    prep_photos?: string[] | null;
  };
  const sheets = sheetRows
    .map(mapSheetRow)
    .sort((a, b) => a.sheetIndex - b.sheetIndex);
  // Champs legacy pointent sur sheets[0] (fallback si pas encore de sheet).
  const s0: Partial<RecipeSheet> = sheets[0] ?? {};
  return {
    id: row.slug,
    internalId: typeof row.id === 'number' ? row.id : Number(row.id),
    title: row.title,
    category: row.category as RecipeCategory,
    coverImage: row.cover_image_url ?? '',
    slides: row.slides ?? [],
    isSeasonal: r.is_seasonal ?? false,
    isFeatured: r.is_featured ?? false,
    isPublic: row.is_public ?? false,
    likesCount: r.likes_count ?? 0,
    prepPhotos: r.prep_photos ?? [],
    sheets,
    // Legacy
    calories: s0.calories ?? null,
    prepTimeMin: s0.prepTimeMin ?? null,
    cookTimeMin: s0.cookTimeMin ?? null,
    servings: s0.servings ?? 4,
    tags: s0.tags ?? [],
    aliments: s0.aliments ?? [],
    ingredients: s0.ingredients ?? [],
    ingredientsText: s0.ingredientsText ?? null,
  };
}

/**
 * Fetch les sheets pour un set de recipeIds. Retourne un index
 * recipeId → sheet[].
 */
async function fetchSheetsFor(
  supabase: ReturnType<typeof createServiceClient>,
  recipeIds: number[],
): Promise<Map<number, any[]>> {
  const map = new Map<number, any[]>();
  if (recipeIds.length === 0) return map;
  const { data, error } = await (supabase as any)
    .from('recipe_sheets')
    .select('*')
    .in('recipe_id', recipeIds)
    .order('sheet_index', { ascending: true });
  if (error) {
    // Si la table n'existe pas encore (migration pas tournée), on continue
    // avec des recettes sans sheets — fallback sur les champs legacy DB.
    if ((error as any).code === '42P01') return map;
    throw error;
  }
  for (const row of data ?? []) {
    const rid = Number((row as any).recipe_id);
    if (!map.has(rid)) map.set(rid, []);
    map.get(rid)!.push(row);
  }
  return map;
}

// =============================================================
// Reads publics
// =============================================================

export async function getPublishedRecipes(): Promise<Recipe[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const sheets = await fetchSheetsFor(
    supabase,
    rows.map((r) => Number(r.id)),
  );
  return rows.map((r) => buildRecipe(r, sheets.get(Number(r.id)) ?? []));
}

/**
 * Version "lite" pour la PAGE LISTE /recettes.
 *
 * SÉCURITÉ : les utilisatrices non-abonnées ne doivent JAMAIS recevoir
 * le contenu détaillé des recettes (ingredients + ingredients_text +
 * prep). Sinon il suffit d'ouvrir les DevTools du navigateur pour
 * récupérer toutes les recettes en clair.
 *
 * Ce helper ne fait PAS `select('*')` : on liste explicitement les
 * colonnes à ramener. Sur `recipe_sheets`, on EXCLUT volontairement
 * `ingredients` et `ingredients_text`. mapSheetRow est tolérant à
 * l'absence de ces champs (ingredients = [], ingredientsText = null).
 *
 * Le détail complet n'est fetché qu'au clic sur une recette via
 * `getRecipeBySlug`, et seulement si l'utilisatrice a un plan actif
 * (gate dans /recettes/[id]/page.tsx).
 */
export async function getPublishedRecipesLite(): Promise<Recipe[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('recipes')
    .select(
      'id, slug, title, category, cover_image_url, slides, is_public, is_seasonal, is_featured, prep_photos, likes_count, published_at, status',
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const recipeIds = rows.map((r) => Number(r.id));

  const sheetsMap = new Map<number, any[]>();
  if (recipeIds.length > 0) {
    const { data: sheetRows, error: shErr } = await (supabase as any)
      .from('recipe_sheets')
      .select(
        // PAS de "ingredients" ni "ingredients_text" : le détail reste
        // confidentiel tant qu'on n'a pas l'abonnement.
        'id, recipe_id, sheet_index, title, cover_image_url, servings, calories, prep_time_min, cook_time_min, tags, aliments, likes_count, nutriscore_grade, nutriscore_confidence',
      )
      .in('recipe_id', recipeIds)
      .order('sheet_index', { ascending: true });
    if (!shErr) {
      for (const r of sheetRows ?? []) {
        const rid = Number((r as any).recipe_id);
        if (!sheetsMap.has(rid)) sheetsMap.set(rid, []);
        sheetsMap.get(rid)!.push(r);
      }
    }
  }

  return rows.map((r) =>
    buildRecipe(r as RecipeRow, sheetsMap.get(Number(r.id)) ?? []),
  );
}

export async function getRecipeBySlug(slug: string): Promise<Recipe | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const sheets = await fetchSheetsFor(supabase, [Number(data.id)]);
  return buildRecipe(data, sheets.get(Number(data.id)) ?? []);
}


// =============================================================
// Reads admin
// =============================================================

export async function getAllRecipesAdmin(): Promise<(Recipe & { status: string })[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const sheets = await fetchSheetsFor(supabase, rows.map((r) => Number(r.id)));
  return rows.map((r) => ({
    ...buildRecipe(r, sheets.get(Number(r.id)) ?? []),
    status: r.status,
  }));
}

export async function getRecipeAdminBySlug(
  slug: string,
): Promise<(Recipe & { status: string }) | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const sheets = await fetchSheetsFor(supabase, [Number(data.id)]);
  return {
    ...buildRecipe(data, sheets.get(Number(data.id)) ?? []),
    status: data.status,
  };
}

/**
 * Récupère UNE sheet précise via son id. Sert au toggle dans la
 * liste de courses (on doit pouvoir résoudre l'id stable pour
 * retrieve l'ingrédients à ajouter).
 */
export async function getSheetById(sheetId: string): Promise<{
  recipeSlug: string;
  sheet: RecipeSheet;
} | null> {
  const supabase = createServiceClient();
  const { data, error } = await (supabase as any)
    .from('recipe_sheets')
    .select('*, recipes(slug)')
    .eq('id', sheetId)
    .maybeSingle();
  if (error) {
    if ((error as any).code === '42P01') return null;
    throw error;
  }
  if (!data) return null;
  return {
    recipeSlug: (data as any).recipes?.slug ?? '',
    sheet: mapSheetRow(data),
  };
}
