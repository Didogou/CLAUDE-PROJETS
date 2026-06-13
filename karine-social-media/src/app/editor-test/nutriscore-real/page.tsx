import { createServiceClient } from '@/lib/supabase/server';
import {
  aggregateIngredients,
  type CiqualFoodLite,
  type RecipeIngredientLite,
} from '@/lib/nutriscore-aggregate';
import { computeNutriscore } from '@/lib/nutriscore';
import { NutriScoreBadge } from '@/components/recettes/NutriScoreBadge';

export const dynamic = 'force-dynamic';

// Les types Database/typegen ne sont pas à jour avec ciqual_foods +
// recipe_sheets — on utilise des assertions any pour les Supabase calls.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POC Palier 1.5 : calcul Nutri-Score sur les VRAIES recettes Karine
 * (BDD prod), avec un matching Ciqual basique par nom + agrégation
 * naïve. Au Palier 3, matching Ciqual via Mistral + persistence en BDD.
 *
 * Sert à :
 *  - Valider l'algo Nutri-Score sur du vrai data
 *  - Repérer les pain points (ingrédients sans qty, sans unité, non
 *    matchés Ciqual) avant de figer la BDD au Palier 2
 *  - Donner à Didier un visuel concret pour décider du seuil de
 *    "confiance" en dessous duquel on n'affiche pas le badge.
 *
 * À RETIRER ou rendre admin-only après validation.
 */
export default async function NutriScoreRealPage() {
  const supa = createServiceClient() as any;

  // Fetch tout le nécessaire en parallèle (recettes + sheets).
  // Ciqual paginé séparément car PostgREST limite à 1000 lignes/req.
  const [recipesRes, sheetsRes] = await Promise.all([
    supa
      .from('recipes')
      .select('id, slug, title, category, is_public')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(20),
    supa
      .from('recipe_sheets')
      .select('id, recipe_id, sheet_index, title, calories, servings, ingredients'),
  ]);

  // Pagination Ciqual : on assemble les 3500+ aliments en 4 fetches.
  const CIQUAL_FIELDS =
    'id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g, fibers_g, sugars_g, salt_g, sodium_mg';
  const ciqualAccum: any[] = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const { data: page } = await supa
      .from('ciqual_foods')
      .select(CIQUAL_FIELDS)
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    const arr = (page ?? []) as any[];
    if (arr.length === 0) break;
    ciqualAccum.push(...arr);
    if (arr.length < 1000) break;
  }
  const ciqualRes = { data: ciqualAccum };

  const recipes = (recipesRes.data ?? []) as Array<{
    id: number;
    slug: string;
    title: string;
    category: string;
    is_public: boolean;
  }>;
  const sheets = (sheetsRes.data ?? []) as Array<{
    id: string;
    recipe_id: number;
    sheet_index: number;
    title: string | null;
    calories: number | null;
    servings: number;
    ingredients: RecipeIngredientLite[];
  }>;
  const ciqualFoods = (ciqualRes.data ?? []) as Array<CiqualFoodLite & { group_name: string | null }>;
  const ciqualGroups = new Map<number, string>(
    ciqualFoods.map((f) => [f.id, f.group_name ?? '']),
  );

  // Map sheets par recette_id
  const sheetsByRecipe = new Map<number, typeof sheets>();
  for (const s of sheets) {
    if (!sheetsByRecipe.has(s.recipe_id)) sheetsByRecipe.set(s.recipe_id, []);
    sheetsByRecipe.get(s.recipe_id)!.push(s);
  }

  return (
    <div className="min-h-screen bg-cream p-4 lg:p-10">
      <header className="mx-auto mb-6 max-w-6xl">
        <h1 className="font-script text-4xl text-coral lg:text-5xl">
          Nutri-Score — Calcul réel BDD
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Recettes Karine extraites de la BDD, scores calculés via
          agrégation Ciqual (matching basique par nom). Les % de confiance
          en dessous de 60 % indiquent que des ingrédients manquent ou
          n&apos;ont pas pu être identifiés.
        </p>
        <p className="mt-1 text-xs italic text-ink-soft">
          {recipes.length} recettes · {ciqualFoods.length} aliments
          Ciqual disponibles
        </p>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {recipes.map((r) => {
          const rSheets = sheetsByRecipe.get(r.id) ?? [];
          const firstSheet = rSheets[0];
          if (!firstSheet) {
            return (
              <RecipeCardNoSheet
                key={r.id}
                title={r.title}
                category={r.category}
              />
            );
          }

          const ings = (Array.isArray(firstSheet.ingredients)
            ? firstSheet.ingredients
            : []) as RecipeIngredientLite[];

          if (ings.length === 0) {
            return (
              <RecipeCardNoIngs
                key={r.id}
                title={r.title}
                category={r.category}
              />
            );
          }

          const agg = aggregateIngredients(ings, ciqualFoods, ciqualGroups);
          const score = computeNutriscore(agg.per100g, 'GENERIC');
          const isLowConfidence = agg.confidence < 0.6;

          return (
            <div
              key={r.id}
              className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30"
            >
              <div className="mb-3">
                <h2 className="text-sm font-bold text-ink line-clamp-2">
                  {r.title}
                </h2>
                <p className="text-xs italic text-ink-soft">
                  {r.category} · {ings.length} ingrédient(s)
                </p>
              </div>

              <div className="mb-3 flex justify-center">
                <NutriScoreBadge grade={score.grade} size="sm" />
              </div>

              {/* Bandeau confiance */}
              <div
                className={`mb-3 rounded-md px-2 py-1 text-center text-xs font-semibold ${
                  isLowConfidence
                    ? 'bg-tangerine/15 text-tangerine'
                    : agg.confidence >= 0.85
                      ? 'bg-sage/20 text-sage'
                      : 'bg-coral-soft/20 text-coral-dark'
                }`}
              >
                Confiance : {Math.round(agg.confidence * 100)} %
                {isLowConfidence && ' (score approximatif)'}
              </div>

              <details className="text-xs text-ink-soft">
                <summary className="cursor-pointer font-semibold">
                  Détail ({score.points} pts · {Math.round(agg.totalGrams)} g total)
                </summary>
                <div className="mt-2 space-y-1">
                  <div>kcal/100g : {Math.round(agg.per100g.kcal)}</div>
                  <div>Sucres : {agg.per100g.sugars.toFixed(1)} g</div>
                  <div>AGS : {agg.per100g.saturatedFat.toFixed(1)} g</div>
                  <div>Sodium : {Math.round(agg.per100g.sodiumMg)} mg</div>
                  <div>Fibres : {agg.per100g.fibers.toFixed(1)} g</div>
                  <div>Protéines : {agg.per100g.proteins.toFixed(1)} g</div>
                  <div>FVL : {Math.round(agg.per100g.fruitsVegLegumesPct)} %</div>
                </div>

                {agg.problems.length > 0 && (
                  <div className="mt-3 border-t border-coral-soft/30 pt-2">
                    <p className="mb-1 font-bold text-tangerine">
                      Problèmes ({agg.problems.length}) :
                    </p>
                    <ul className="space-y-0.5 text-[0.65rem]">
                      {agg.problems.slice(0, 10).map((p, i) => (
                        <li key={i}>
                          <span className="font-semibold">{p.label}</span>{' '}
                          <span className="italic text-ink-soft">
                            {p.reason === 'no-quantity' && '— pas de quantité'}
                            {p.reason === 'no-ciqual-match' &&
                              '— pas trouvé en Ciqual'}
                            {p.reason === 'estimated-weight' &&
                              `— poids estimé (${p.estimatedGrams} g)`}
                          </span>
                        </li>
                      ))}
                      {agg.problems.length > 10 && (
                        <li className="italic">
                          ... +{agg.problems.length - 10} autres
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecipeCardNoSheet({ title, category }: { title: string; category: string }) {
  return (
    <div className="rounded-2xl bg-white/70 p-4 shadow-sm ring-1 ring-coral-soft/30 opacity-60">
      <h2 className="text-sm font-bold text-ink line-clamp-2">{title}</h2>
      <p className="text-xs italic text-ink-soft">{category}</p>
      <p className="mt-3 text-xs text-tangerine">⚠ Aucune fiche détaillée</p>
    </div>
  );
}

function RecipeCardNoIngs({ title, category }: { title: string; category: string }) {
  return (
    <div className="rounded-2xl bg-white/70 p-4 shadow-sm ring-1 ring-coral-soft/30 opacity-60">
      <h2 className="text-sm font-bold text-ink line-clamp-2">{title}</h2>
      <p className="text-xs italic text-ink-soft">{category}</p>
      <p className="mt-3 text-xs text-tangerine">⚠ Aucun ingrédient renseigné</p>
    </div>
  );
}
