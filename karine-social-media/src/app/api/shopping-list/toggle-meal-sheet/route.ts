import { NextResponse, type NextRequest } from 'next/server';
import { requireUserWithHousehold } from '@/lib/user-guard';
import { getMealSheetById } from '@/lib/menus';
import { toggleSheetOnActiveList } from '@/lib/shopping-lists';

/**
 * POST /api/shopping-list/toggle-meal-sheet
 * Body : { mealSheetId, portionsOverride? }
 *
 * Toggle d'une fiche repas du menu (menu_meal_sheets) dans la liste
 * active. On réutilise toggleSheetOnActiveList côté backend en
 * passant un faux recipeSlug (le menu n'a pas de slug recette) — la
 * source 'sheet' continue de tracer correctement.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserWithHousehold();
  if ('error' in auth) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const mealSheetId =
      typeof body?.mealSheetId === 'string' ? body.mealSheetId.trim() : '';
    if (!mealSheetId) {
      return NextResponse.json({ error: 'mealSheetId requis' }, { status: 400 });
    }
    const sheet = await getMealSheetById(mealSheetId);
    if (!sheet) {
      return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 });
    }
    if (sheet.ingredients.length === 0) {
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

    // On adapte vers le helper sheets existant (la traçabilité par
    // source 'sheet' est suffisante — menu/recette indistinguables côté
    // contributions, ce qui est acceptable pour la liste de courses).
    const list = await toggleSheetOnActiveList(
      auth.user.id,
      {
        sheetId: sheet.id,
        recipeSlug: `menu-${sheet.menuId}-${sheet.dayIndex}-${sheet.mealKind}`,
        sheetTitle: sheet.title || 'Repas du menu',
        coverUrl: sheet.coverImageUrl || null,
        servings: sheet.servings,
        ingredients: sheet.ingredients.map((it) => ({
          category: it.category,
          label: it.label,
          quantity: it.quantity,
          unit: it.unit,
          note: it.note ?? null,
        })),
      },
      auth.user.householdSize,
      portionsOverride,
    );
    return NextResponse.json({ list });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
