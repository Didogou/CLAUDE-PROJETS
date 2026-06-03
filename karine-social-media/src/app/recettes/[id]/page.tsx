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
  const [comments, all, favorited] = await Promise.all([
    getVisibleCommentsForRecipe(recipe.id),
    getPublishedRecipes(),
    user.id ? isFavorited(user.id, 'recipe', recipe.id) : Promise.resolve(false),
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

      {/* Header simplifié : retour + logo. Le bouton "Ajouter aux favoris"
          est désormais en overlay top-right de l'image de la fiche dans
          SheetCarousel (UX demandée par Didier 2026-06-03). */}
      <header className="relative flex items-center justify-between px-5 py-6 lg:py-8 print:hidden">
        <Link
          href={`/recettes/${CATEGORY_SLUG[recipe.category]}`}
          aria-label={`Retour aux ${recipe.category}`}
          className="z-10 grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink transition hover:bg-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Logo />
        </div>
        <span aria-hidden className="h-10 w-10" />
      </header>

      <TrackView
        type="recipe"
        id={recipe.id}
        label={recipe.title}
        imageUrl={images[0] ?? null}
        href={`/recettes/${recipe.id}`}
      />

      {/* Carrousel des fiches détaillées (chaque fiche = une variante de
          la recette avec son bouton "Ajouter à ma liste" propre).
          Layout : center sur mobile, max-w-3xl sur PC pour image grande. */}
      {recipe.sheets.length > 0 && (
        <div className="mx-auto w-full max-w-3xl px-4 print:hidden lg:px-6">
          <SheetCarousel
            sheets={recipe.sheets}
            isAuthenticated={user.isAuthenticated}
            recipeId={recipe.id}
            recipeTitle={recipe.title}
            favoritedInitial={favorited}
            likesCountInitial={recipe.likesCount}
          />
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
