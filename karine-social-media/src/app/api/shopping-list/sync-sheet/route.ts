import { NextResponse, type NextRequest } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import { syncSheetOnActiveList } from '@/lib/shopping-lists';
import { getSheetById } from '@/lib/recipes';

/**
 * POST /api/shopping-list/sync-sheet
 * Body : { sheetId, portionsOverride? }
 *
 * Synchronise une fiche dans la liste avec un nombre de portions.
 * - Si la fiche n'est pas encore dans la liste : l'ajoute.
 * - Si elle y est déjà : met à jour les quantités sans la retirer.
 *
 * Utilise par le stepper PERS quand la recette est deja dans la
 * liste — l'utilisatrice modifie le nb de personnes et la liste
 * suit (sans avoir a re-toggler).
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const sheetId = typeof body?.sheetId === 'string' ? body.sheetId.trim() : '';
    if (!sheetId) {
      return NextResponse.json({ error: 'sheetId requis' }, { status: 400 });
    }
    const found = await getSheetById(sheetId);
    if (!found) {
      return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 });
    }
    if (found.sheet.ingredients.length === 0) {
      return NextResponse.json(
        { error: "Cette fiche n'a pas d'ingrédients structurés." },
        { status: 409 },
      );
    }
    const portionsOverrideRaw = body?.portionsOverride;
    const portionsOverride =
      typeof portionsOverrideRaw === 'number' &&
      Number.isFinite(portionsOverrideRaw) &&
      portionsOverrideRaw > 0
        ? Math.round(portionsOverrideRaw)
        : undefined;
    const { list, action } = await syncSheetOnActiveList(
      auth.user.id,
      {
        sheetId: found.sheet.id,
        recipeSlug: found.recipeSlug,
        sheetTitle: found.sheet.title || 'Fiche sans titre',
        coverUrl: found.sheet.coverImageUrl || null,
        servings: found.sheet.servings,
        ingredients: found.sheet.ingredients,
      },
      auth.user.householdSize,
      portionsOverride,
    );
    return NextResponse.json({ list, action });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
