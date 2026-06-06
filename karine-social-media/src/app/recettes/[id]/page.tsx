import { notFound, redirect } from 'next/navigation';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { MenuDayHeader } from '@/components/menus/MenuDayHeader';
import { TrackView } from '@/components/garde/TrackView';
import { RecipeDetailView } from '@/components/recettes/RecipeDetailView';
import { SheetCarousel } from '@/components/recettes/SheetCarousel';
import { getPublishedRecipes, getRecipeBySlug } from '@/lib/recipes';
import { getVisibleCommentsForRecipe } from '@/lib/comments';
import { getCurrentUser } from '@/lib/current-user';
import { isFavorited } from '@/lib/favorites';
import { getUserLikedSheetIds } from '@/lib/sheet-likes';
import { CATEGORY_SLUG } from '@/data/recipes';
import { userHasPlanAccess } from '@/lib/user-access';

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
    getPublishedRecipes(),
    user.id ? isFavorited(user.id, 'recipe', recipe.id) : Promise.resolve(false),
    getUserLikedSheetIds(user.id, sheetIds),
  ]);
  const suggestions = [
    ...all.filter((r) => r.id !== recipe.id && r.category === recipe.category),
    ...all.filter((r) => r.id !== recipe.id && r.category !== recipe.category),
  ].slice(0, 8);

  return (
    <div className="relative flex min-h-screen flex-col print:bg-white">
      {/* FloralBackground et MenuDayHeader DOIVENT être enfants directs
          du flex parent pour que `sticky top-0` du header reste actif
          tout au long du scroll. Le back arrow ramène à la catégorie
          parente (ex. "Plats") plutôt qu'à la liste générale. */}
      <FloralBackground />
      <MenuDayHeader backHref={`/recettes/${CATEGORY_SLUG[recipe.category]}`} />

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
