import { notFound, redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { TrackView } from '@/components/garde/TrackView';
import { RecipeDetailView } from '@/components/recettes/RecipeDetailView';
import { SheetCarousel } from '@/components/recettes/SheetCarousel';
import { getPublishedRecipesLite, getRecipeBySlug } from '@/lib/recipes';
import { getVisibleCommentsForRecipe } from '@/lib/comments';
import { getCurrentUser } from '@/lib/current-user';
import { isFavorited } from '@/lib/favorites';
import { getUserLikedSheetIds } from '@/lib/sheet-likes';
import { userHasPlanAccess } from '@/lib/user-access';
import { createServiceClient } from '@/lib/supabase/server';
import {
  quickMatchCiqual,
  type CiqualFoodLite,
} from '@/lib/nutriscore-aggregate';
import { searchCiqualFoods } from '@/lib/ciqual';
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = 'force-dynamic';

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recipe = await getRecipeBySlug(id);
  if (!recipe || recipe.coverImage === '') notFound();

  // Gate accès : si la recette n'est PAS publique et que l'utilisatrice
  // n'a pas de plan actif → redirect vers /mon-plan avec next préservé.
  // Évite que la page rende du contenu inaccessible (et limite le
  // contournement via URL directe).
  const userHasPlan = await userHasPlanAccess();
  if (!recipe.isPublic && !userHasPlan) {
    redirect(`/mon-plan?next=/recettes/${recipe.id}`);
  }

  const images = [recipe.coverImage, ...recipe.slides];

  const user = await getCurrentUser();
  const sheetIds = recipe.sheets.map((s) => s.id);
  const [comments, all, favorited, likedSheetIds] = await Promise.all([
    getVisibleCommentsForRecipe(recipe.id),
    // Suggestions : Lite suffit (cartes affichant cover/titre/grade
    // uniquement). On évite de sérialiser les ingredients des 20+ autres
    // recettes dans le payload du browser.
    getPublishedRecipesLite(),
    user.id ? isFavorited(user.id, 'recipe', recipe.id) : Promise.resolve(false),
    getUserLikedSheetIds(user.id, sheetIds),
  ]);
  const suggestions = [
    ...all.filter((r) => r.id !== recipe.id && r.category === recipe.category),
    ...all.filter((r) => r.id !== recipe.id && r.category !== recipe.category),
  ].slice(0, 8);

  // Le Nutri-Score est lu PAR SHEET via les colonnes BDD. Pour la
  // modale "Détail nutritionnel", on a besoin des Ciqual liés.
  //
  // Cas 1 (idéal, ingrédients déjà liés par Karine ou batch nouveau) :
  //   on fetch les Ciqual des ids présents (1 query IN).
  //
  // Cas 2 (transitoire, sheets héritées du batch ancien sans liens) :
  //   on fetch tout Ciqual (paginé), on résout les matches en mémoire,
  //   on collecte les Ciqual matchés. Lent (~4 queries) mais évite à
  //   l'utilisatrice d'attendre le re-run du batch admin.
  const linkedCiqualIds = new Set<number>();
  let hasUnlinkedIngredients = false;
  for (const sheet of recipe.sheets) {
    for (const ing of sheet.ingredients) {
      if (typeof ing.ciqual_food_id === 'number') {
        linkedCiqualIds.add(ing.ciqual_food_id);
      } else if (typeof ing.quantity === 'number' && ing.quantity > 0) {
        hasUnlinkedIngredients = true;
      }
    }
  }
  let ciqualByIdEntries: Array<[number, CiqualFoodLite]> = [];
  const supa = createServiceClient() as any;

  // Stratégie 2026-06-12 (audit perf B #2) :
  // Avant : si UN seul ingrédient était unlinked, on téléchargeait TOUTE
  // la Ciqual (4 round-trips, ~600 KB JSON parsé) → +1-3s de TTFB.
  // Maintenant : pour chaque label unlinked, on appelle searchCiqualFoods
  // (RPC qui exploite l'index GIN trigram) en parallèle, max 10 candidats
  // par label. Puis on collecte tous les ids candidats + linkedIds et on
  // fait UNE seule query `.in(ids)` pour récupérer les rows complètes
  // avec avg_unit_weight_g (nécessaire à la modale Détail nutritionnel).
  if (hasUnlinkedIngredients) {
    // Collecte les labels unlinked
    const unlinkedLabels: string[] = [];
    for (const sheet of recipe.sheets) {
      for (const ing of sheet.ingredients) {
        if (typeof ing.ciqual_food_id === 'number') continue;
        if (typeof ing.quantity !== 'number' || ing.quantity <= 0) continue;
        unlinkedLabels.push(ing.label);
      }
    }
    // RPC search en parallèle pour les unlinked
    const searchResults = await Promise.all(
      unlinkedLabels.map((label) =>
        searchCiqualFoods(label, 10).catch(() => []),
      ),
    );
    // Collecte tous les ids candidats (search) + linked
    const allIds = new Set<number>(linkedCiqualIds);
    for (const r of searchResults) {
      for (const cand of r) allIds.add(cand.id);
    }
    if (allIds.size > 0) {
      // UNE query pour les Lite avec tous les champs nécessaires
      const { data } = await supa
        .from('ciqual_foods')
        .select(
          'id, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g, fibers_g, sugars_g, salt_g, sodium_mg, avg_unit_weight_g',
        )
        .in('id', Array.from(allIds));
      const pool = (data ?? []) as CiqualFoodLite[];
      const collected = new Map<number, CiqualFoodLite>();
      // Garde les liens explicites
      for (const c of pool) {
        if (linkedCiqualIds.has(c.id)) collected.set(c.id, c);
      }
      // Match orphelins sur le pool restreint
      for (const sheet of recipe.sheets) {
        for (const ing of sheet.ingredients) {
          if (typeof ing.ciqual_food_id === 'number') continue;
          if (typeof ing.quantity !== 'number' || ing.quantity <= 0) continue;
          const m = quickMatchCiqual(ing.label, pool);
          if (m && !collected.has(m.id)) collected.set(m.id, m);
        }
      }
      ciqualByIdEntries = Array.from(collected.entries());
    }
  } else if (linkedCiqualIds.size > 0) {
    const { data } = await supa
      .from('ciqual_foods')
      .select(
        'id, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g, fibers_g, sugars_g, salt_g, sodium_mg, avg_unit_weight_g',
      )
      .in('id', Array.from(linkedCiqualIds));
    const arr = (data ?? []) as CiqualFoodLite[];
    ciqualByIdEntries = arr.map((c) => [c.id, c]);
  }

  // Patch des ingrédients pour que la modale retrouve le ciqual_food_id
  // par label même quand il n'est pas persisté. On enrichit la sheet
  // en mémoire seulement (pas d'écriture BDD côté lecture).
  if (hasUnlinkedIngredients && ciqualByIdEntries.length > 0) {
    const ciqualPool = ciqualByIdEntries.map(([, c]) => c);
    for (const sheet of recipe.sheets) {
      sheet.ingredients = sheet.ingredients.map((ing) => {
        if (typeof ing.ciqual_food_id === 'number') return ing;
        if (typeof ing.quantity !== 'number' || ing.quantity <= 0) return ing;
        const m = quickMatchCiqual(ing.label, ciqualPool);
        return m ? { ...ing, ciqual_food_id: m.id } : ing;
      });
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col print:bg-white">
      {/* FloralBackground et AppHeader DOIVENT être enfants directs
          du flex parent pour que `sticky top-0` du header reste actif
          tout au long du scroll. backHref ramène à la liste des
          recettes (onglets). */}
      <FloralBackground />
      {/* backHref inclut ?cat=… + ?highlight=… pour que /recettes :
          1) ouvre sur l'onglet correspondant à la catégorie
          2) scroll automatiquement sur la card de cette recette
          3) flash visuellement la card (UX 2026-06-11). */}
      <AppHeader
        pageTitle={recipe.title}
        backHref={`/recettes?cat=${encodeURIComponent(recipe.category)}&highlight=${encodeURIComponent(recipe.id)}`}
      />

      <TrackView
        type="recipe"
        id={recipe.id}
        label={recipe.title}
        imageUrl={images[0] ?? null}
        href={`/recettes/${recipe.id}`}
      />

      {/* Carrousel des fiches détaillées + aside commentaires en colonne
          DROITE sur PC. Grid 3 cols équilibré [20rem | 1fr | 20rem] :
          - Colonne gauche : spacer vide (symétrie pour centrer la fiche)
          - Colonne centre : SheetCarousel (vraiment centré viewport)
          - Colonne droite : aside commentaires (sticky)
          Mobile : SheetCarousel centre, commentaires rendus en bas
                   par RecipeDetailView ci-dessous (flux normal). */}
      {recipe.sheets.length > 0 && (
        <div className="mx-auto mb-8 w-full max-w-3xl px-4 print:hidden lg:mb-12 lg:max-w-7xl lg:grid lg:grid-cols-[20rem_minmax(0,1fr)_20rem] lg:gap-6 lg:px-6">
          {/* Spacer gauche vide (symétrie visuelle pour centrer la fiche) */}
          <div aria-hidden className="hidden lg:block" />

          <SheetCarousel
            sheets={recipe.sheets}
            isAuthenticated={user.isAuthenticated}
            recipeId={recipe.id}
            recipeTitle={recipe.title}
            favoritedInitial={favorited}
            likesCountInitial={recipe.likesCount}
            initialLikedSheetIds={[...likedSheetIds]}
            ciqualByIdEntries={ciqualByIdEntries}
          />

          {/* Aside commentaires PC uniquement (colonne droite) */}
          <div className="hidden lg:block">
            <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
              <RecipeDetailView
                slug={recipe.id}
                title={recipe.title}
                category={recipe.category}
                images={images}
                prepPhotos={recipe.prepPhotos}
                suggestions={suggestions}
                isSeasonal={recipe.isSeasonal}
                prepTimeMin={recipe.prepTimeMin}
                cookTimeMin={recipe.cookTimeMin}
                initialLikes={recipe.likesCount}
                initialComments={comments.map((c) => ({
                  id: c.id,
                  author: c.authorName,
                  text: c.body,
                  photos: c.photos,
                  likesCount: c.likesCount,
                  parentId: c.parentId,
                  parentAuthor: c.parentAuthor,
                }))}
                asideCommentsOnly
              />
            </div>
          </div>
        </div>
      )}

      {/* Le bandeau Nutri-Score est désormais rendu DANS SheetCarousel
          (juste sous l'image), via la prop `nutriscoreGrade` calculée
          côté serveur ci-dessus. Plus de block séparé en fin de page. */}

      <RecipeDetailView
        slug={recipe.id}
        title={recipe.title}
        category={recipe.category}
        images={images}
        prepPhotos={recipe.prepPhotos}
        suggestions={suggestions}
        isSeasonal={recipe.isSeasonal}
        prepTimeMin={recipe.prepTimeMin}
        cookTimeMin={recipe.cookTimeMin}
        initialLikes={recipe.likesCount}
        initialComments={comments.map((c) => ({
          id: c.id,
          author: c.authorName,
          text: c.body,
          photos: c.photos,
          likesCount: c.likesCount,
          parentId: c.parentId,
          parentAuthor: c.parentAuthor,
        }))}
        hideMainBlock={recipe.sheets.length > 0}
      />

      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
