import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import {
  CATEGORY_ORDER,
  type Recipe,
  type RecipeCategory,
  type RecipeIngredient,
} from '@/data/recipes';
import type { Database } from '@/types/database';

type RecipeRow = Database['public']['Tables']['recipes']['Row'];

function mapRow(row: RecipeRow): Recipe {
  // is_seasonal et is_featured ne sont pas encore dans les types générés tant que
  // les migrations correspondantes ne sont pas reflétées par `supabase gen types`.
  const r = row as RecipeRow & {
    is_seasonal?: boolean | null;
    is_featured?: boolean | null;
    likes_count?: number | null;
    prep_photos?: string[] | null;
    prep_time_min?: number | null;
    cook_time_min?: number | null;
    servings?: number | null;
    ingredients?: unknown;
  };
  // ingredients jsonb : on filtre les entrées malformées par sécurité.
  const rawIngredients = r.ingredients;
  const ingredients: RecipeIngredient[] = Array.isArray(rawIngredients)
    ? rawIngredients
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((it: any) => it && typeof it.label === 'string' && typeof it.category === 'string')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((it: any) => ({
          category: String(it.category),
          label: String(it.label),
          quantity: typeof it.quantity === 'number' ? it.quantity : null,
          unit: typeof it.unit === 'string' ? it.unit : null,
          note: typeof it.note === 'string' ? it.note : null,
        }))
    : [];
  return {
    id: row.slug,
    title: row.title,
    category: row.category as RecipeCategory,
    coverImage: row.cover_image_url ?? '',
    slides: row.slides ?? [],
    tags: row.tags ?? [],
    calories: row.calories,
    aliments: row.aliments ?? [],
    isSeasonal: r.is_seasonal ?? false,
    isFeatured: r.is_featured ?? false,
    likesCount: r.likes_count ?? 0,
    prepPhotos: r.prep_photos ?? [],
    prepTimeMin: r.prep_time_min ?? null,
    cookTimeMin: r.cook_time_min ?? null,
    servings: typeof r.servings === 'number' ? r.servings : 4,
    ingredients,
  };
}

// NOTE: lecture via service_role pendant la phase sans-auth (connexion à brancher
// plus tard). On filtre sur status = 'published' côté requête.
export async function getPublishedRecipes(): Promise<Recipe[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function getRecipeBySlug(slug: string): Promise<Recipe | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('recipes').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

// Pour chaque catégorie : la recette épinglée la plus récente (ou la dernière publiée
// à défaut) + les N suivantes par date pour former la pile derrière.
// Renvoie aussi le total publié par catégorie (pour le compteur).
export type CategoryDeckData = {
  featured: Recipe | null;
  stack: Recipe[];
  totalCount: number;
};

export async function getCategoryDecks(
  stackSize = 3,
): Promise<Record<RecipeCategory, CategoryDeckData>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) throw error;

  const all = (data ?? []).map(mapRow);

  const out = {} as Record<RecipeCategory, CategoryDeckData>;
  for (const cat of CATEGORY_ORDER) {
    const inCat = all.filter((r) => r.category === cat);
    // featured = la épinglée la plus récente, sinon la plus récente tout court
    const pinned = inCat.find((r) => r.isFeatured);
    const featured = pinned ?? inCat[0] ?? null;
    const stack = featured
      ? inCat.filter((r) => r.id !== featured.id).slice(0, stackSize)
      : [];
    out[cat] = { featured, stack, totalCount: inCat.length };
  }
  return out;
}

export async function getRecipesByCategory(category: RecipeCategory): Promise<Recipe[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('status', 'published')
    .eq('category', category)
    .order('published_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

// Admin : toutes les recettes, tous statuts
export async function getAllRecipesAdmin(): Promise<(Recipe & { status: string })[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...mapRow(r), status: r.status }));
}

// Admin : récupère une recette par slug (avec status), tous statuts
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
  return data ? { ...mapRow(data), status: data.status } : null;
}
