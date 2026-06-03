import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { Logo } from '@/components/brand/Logo';
import { TrackView } from '@/components/garde/TrackView';
import { RecipeDetailView } from '@/components/recettes/RecipeDetailView';
import { SheetCarousel } from '@/components/recettes/SheetCarousel';
import { getPublishedRecipes, getRecipeBySlug } from '@/lib/recipes';
import { getVisibleCommentsForRecipe } from '@/lib/comments';
import { getCurrentUser } from '@/lib/current-user';
import { isFavorited } from '@/lib/favorites';
import { getUserLikedSheetIds } from '@/lib/sheet-likes';
import { CATEGORY_SLUG } from '@/data/recipes';

export const dynamic = 'force-dynamic';

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recipe = await getRecipeBySlug(id);
  if (!recipe || recipe.coverImage === '') notFound();

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
      <div className="print:hidden">
        <FloralBackground />
      </div>

      {/* Header simplifié : retour + logo + spacer. Le Logo est en flow
          normal (pas absolute) pour éviter tout clipping du titre par
          overflow ou hauteur insuffisante du header. Le bouton "Ajouter
          aux favoris" est désormais en overlay sur l'image de la fiche
          (SheetCarousel). */}
      <header className="flex items-center justify-between gap-4 px-5 py-6 lg:py-8 print:hidden">
        <Link
          href={`/recettes/${CATEGORY_SLUG[recipe.category]}`}
          aria-label={`Retour aux ${recipe.category}`}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/70 text-ink transition hover:bg-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <Logo />
        </div>
        <span aria-hidden className="h-10 w-10 shrink-0" />
      </header>

      <TrackView
        type="recipe"
        id={recipe.id}
        label={recipe.title}
        imageUrl={images[0] ?? null}
        href={`/recettes/${recipe.id}`}
      />

      {/* Carrousel des fiches détaillées + aside commentaires en colonne
          DROITE sur PC.
          Mobile : SheetCarousel centre, les commentaires sont rendus en
                    bas par RecipeDetailView ci-dessous (flux normal).
          PC : grid 2 cols [SheetCarousel main | commentaires-aside 20rem].
               Aside commentaires sticky pour rester visible en scrollant. */}
      {recipe.sheets.length > 0 && (
        <div className="mx-auto mb-8 w-full max-w-3xl px-4 print:hidden lg:mb-12 lg:max-w-6xl lg:grid lg:grid-cols-[1fr_20rem] lg:gap-6 lg:px-6">
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
