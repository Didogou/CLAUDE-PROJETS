import { NextResponse, type NextRequest } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import { toggleRecipeOnActiveList } from '@/lib/shopping-lists';
import { getRecipeBySlug } from '@/lib/recipes';

/**
 * POST /api/shopping-list/toggle-recipe
 * Body : { recipeId } (slug)
 *
 * Toggle : si la recette est déjà dans la liste, retire ses contributions.
 * Sinon, ajoute ses ingrédients multipliés par (foyer / servings recette).
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const recipeId = typeof body?.recipeId === 'string' ? body.recipeId.trim() : '';
    if (!recipeId) {
      return NextResponse.json({ error: 'recipeId requis' }, { status: 400 });
    }
    const recipe = await getRecipeBySlug(recipeId);
    if (!recipe) {
      return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 });
    }
    if (recipe.ingredients.length === 0) {
      return NextResponse.json(
        {
          error:
            'Cette recette n\'a pas d\'ingrédients structurés. Karine doit la mettre à jour.',
        },
        { status: 409 },
      );
    }
    const list = await toggleRecipeOnActiveList(
      auth.user.id,
      {
        id: recipe.id,
        title: recipe.title,
        coverUrl: recipe.coverImage || null,
        servings: recipe.servings,
        ingredients: recipe.ingredients,
      },
      auth.user.householdSize,
    );
    return NextResponse.json({ list });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
