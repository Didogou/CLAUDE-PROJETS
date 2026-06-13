/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServiceClient } from '@/lib/supabase/server';
import { NutriScoreAdminClient } from '@/components/admin/NutriScoreAdminClient';
import type { RecipeIngredient } from '@/data/recipes';
import type { CiqualFoodLite } from '@/lib/nutriscore-aggregate';
import {
  computeMenuAvgGrade,
} from '@/lib/menu-nutriscore';
import type { NutriscoreGrade } from '@/lib/nutriscore';

/** Une fiche repas d'un menu (table menu_meal_sheets). Editable comme
 *  une recipe_sheet : qty/unit/ciqual_food_id sur ses ingredients. */
export type MenuMealSheetLite = {
  id: string;
  menuId: string;
  dayIndex: number;
  mealKind: 'lunch' | 'dinner';
  title: string | null;
  servings: number;
  ingredients: RecipeIngredient[];
  nutriscoreGrade: NutriscoreGrade | null;
  nutriscoreConfidence: number | null;
};

export type MenuLite = {
  id: string;
  title: string;
  weekStart: string;
  status: string;
  /** 14 cellules possibles : 7 jours × { lunch, dinner }.
   *  Cellules non remplies = absentes du tableau. */
  mealSheets: MenuMealSheetLite[];
  avgGrade: NutriscoreGrade | null;
  avgConfidence: number;
  avgCount: number;
};

export const dynamic = 'force-dynamic';

/**
 * Page admin /admin/recettes/nutriscore — éditeur Nutri-Score pour
 * Karine.
 *
 * Layout :
 *  - Sidebar gauche : liste des recettes (avec grade actuel + confiance)
 *  - Zone droite : éditeur de la recette sélectionnée
 *      - Liste des ingrédients
 *      - Pour chacun : qty/unit éditable + picker Ciqual
 *      - Badge Nutri-Score live (recalcul à chaque édition)
 *      - Bouton "Sauvegarder" → PATCH endpoint
 *
 * Pas de migration BDD : on stocke `ciqual_food_id` dans le jsonb
 * `ingredients` existant. C'est gratuit.
 */
export default async function AdminNutriScorePage() {
  const supa = createServiceClient() as any;

  const [recipesRes, sheetsRes] = await Promise.all([
    supa
      .from('recipes')
      .select('id, slug, title, category, is_public, status, published_at')
      .order('published_at', { ascending: false, nullsFirst: false }),
    supa
      .from('recipe_sheets')
      .select('id, recipe_id, sheet_index, title, calories, servings, ingredients'),
  ]);

  const recipes = (recipesRes.data ?? []) as Array<{
    id: number;
    slug: string;
    title: string;
    category: string;
    is_public: boolean;
    status: string;
  }>;
  const sheetsRaw = (sheetsRes.data ?? []) as Array<{
    id: string;
    recipe_id: number;
    sheet_index: number;
    title: string | null;
    calories: number | null;
    servings: number;
    ingredients: RecipeIngredient[] | null;
  }>;
  // Garde-fou : ingredients peut être null en BDD sur des fiches
  // anciennes, on les normalise en array vide pour ne pas crasher.
  const sheets = sheetsRaw.map((s) => ({
    ...s,
    ingredients: Array.isArray(s.ingredients) ? s.ingredients : [],
  }));

  // Pour le matching automatique fiable, on envoie TOUTE la table
  // Ciqual au client (~3500 lignes, ~600 KB JSON). C'est une page
  // admin, le coût est acceptable.
  //
  // ATTENTION : PostgREST (le moteur API Supabase) a un MAX-ROWS hard
  // à 1000 lignes par requête, même avec .range(0, 9999). Pour
  // récupérer tout, on doit paginer manuellement en 4 fetches.
  const CIQUAL_FIELDS =
    'id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g, fibers_g, sugars_g, salt_g, sodium_mg, avg_unit_weight_g';
  const PAGE_SIZE = 1000;
  const ciqualBootstrap: CiqualFoodLite[] = [];
  for (let offset = 0; offset < 10000; offset += PAGE_SIZE) {
    const { data: page } = await supa
      .from('ciqual_foods')
      .select(CIQUAL_FIELDS)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    const arr = (page ?? []) as CiqualFoodLite[];
    if (arr.length === 0) break;
    ciqualBootstrap.push(...arr);
    if (arr.length < PAGE_SIZE) break; // dernière page
  }

  // === MENUS — sidebar mode "Menus" =============================
  // Chaque menu hebdo a 0..14 menu_meal_sheets (7 jours × 2 repas).
  // Chaque sheet a ses propres ingredients ET sa colonne nutriscore_*
  // persistée. Karine édite sheet-par-sheet via le même éditeur que
  // pour les recettes (avec un endpoint de save différent).
  const [menusRes, mealsRes] = await Promise.all([
    supa
      .from('weekly_menus')
      .select('id, title, week_start, status, published_at')
      .order('week_start', { ascending: false }),
    supa
      .from('menu_meal_sheets')
      .select(
        'id, menu_id, day_index, meal_kind, title, servings, ingredients, nutriscore_grade, nutriscore_confidence',
      )
      .order('day_index', { ascending: true }),
  ]);
  const menusRows = (menusRes.data ?? []) as Array<{
    id: string;
    title: string | null;
    week_start: string;
    status: string;
  }>;
  const mealsRows = (mealsRes.data ?? []) as Array<{
    id: string;
    menu_id: string;
    day_index: number;
    meal_kind: 'lunch' | 'dinner';
    title: string | null;
    servings: number;
    ingredients: RecipeIngredient[] | null;
    nutriscore_grade: string | null;
    nutriscore_confidence: number | string | null;
  }>;

  const mealsByMenu = new Map<string, MenuMealSheetLite[]>();
  for (const m of mealsRows) {
    const g = m.nutriscore_grade;
    const grade: NutriscoreGrade | null =
      g === 'A' || g === 'B' || g === 'C' || g === 'D' || g === 'E' ? g : null;
    const sheet: MenuMealSheetLite = {
      id: m.id,
      menuId: m.menu_id,
      dayIndex: m.day_index,
      mealKind: m.meal_kind,
      title: m.title,
      servings: m.servings,
      ingredients: Array.isArray(m.ingredients) ? m.ingredients : [],
      nutriscoreGrade: grade,
      nutriscoreConfidence:
        typeof m.nutriscore_confidence === 'number'
          ? m.nutriscore_confidence
          : m.nutriscore_confidence !== null && m.nutriscore_confidence !== undefined
            ? Number(m.nutriscore_confidence)
            : null,
    };
    if (!mealsByMenu.has(m.menu_id)) mealsByMenu.set(m.menu_id, []);
    mealsByMenu.get(m.menu_id)!.push(sheet);
  }

  const menus: MenuLite[] = menusRows.map((m) => {
    const mealSheets = (mealsByMenu.get(m.id) ?? [])
      .slice()
      .sort((a, b) =>
        a.dayIndex !== b.dayIndex
          ? a.dayIndex - b.dayIndex
          : a.mealKind === 'lunch' ? -1 : 1,
      );
    const scoresForAvg = mealSheets.map((s) =>
      s.nutriscoreGrade
        ? { slug: s.id, grade: s.nutriscoreGrade, confidence: s.nutriscoreConfidence ?? 0 }
        : null,
    );
    const avg = computeMenuAvgGrade(scoresForAvg);
    return {
      id: m.id,
      title: m.title ?? '',
      weekStart: m.week_start,
      status: m.status,
      mealSheets,
      avgGrade: avg?.grade ?? null,
      avgConfidence: avg?.confidence ?? 0,
      avgCount: avg?.count ?? 0,
    };
  });

  // Poids de portion par label (aligne l'aperçu admin sur le calcul serveur).
  const { data: pwRows } = await supa
    .from('ingredient_portion_weights')
    .select('label_key, grams');
  const portionWeightEntries = ((pwRows ?? []) as Array<{
    label_key: string;
    grams: number | null;
  }>)
    .filter((r) => r.grams != null && Number(r.grams) > 0)
    .map((r) => [r.label_key, Number(r.grams)] as [string, number]);

  return (
    <NutriScoreAdminClient
      recipes={recipes}
      sheets={sheets}
      ciqualBootstrap={ciqualBootstrap}
      menus={menus}
      portionWeightEntries={portionWeightEntries}
    />
  );
}
