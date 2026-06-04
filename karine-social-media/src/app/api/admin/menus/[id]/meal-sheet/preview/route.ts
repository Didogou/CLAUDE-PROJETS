import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { extractRecipeSheetFromImage } from '@/lib/claude-recipe-vision';
import { estimateMacrosFromIngredients } from '@/lib/macros-estimator';

const BUCKET = 'content-images';
export const maxDuration = 60;

/**
 * POST /api/admin/menus/[id]/meal-sheet/preview
 *
 * Variante "preview" pour l'upload d'une fiche repas (lunch/dinner)
 * d'un jour du menu. Workflow :
 *   1. Reçoit le fichier image (form-data 'file')
 *   2. Optimise WebP
 *   3. Upload dans Storage en zone temp `temp-menu-meal/{uuid}.webp`
 *   4. Lance Vision Haiku 4.5 (le même que pour les fiches recettes)
 *   5. Renvoie { tempPath, imageUrl, ...extracted } au client
 *
 * Le client conserve `tempPath` et l'envoie au moment du save final
 * vers POST /meal-sheet qui déplacera l'image et persistera la sheet.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id: menuId } = await ctx.params;
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'Fichier image requis.' }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Image trop grosse (max 10 Mo).' },
        { status: 400 },
      );
    }

    const { buffer, contentType } = await optimizeUploadToWebp(file);
    const supabase = createServiceClient();

    const tempPath = `temp-menu-meal/${menuId}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}.webp`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(tempPath, buffer, { upsert: true, contentType });
    if (upErr) throw upErr;
    const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(tempPath).data.publicUrl;

    let extracted: Awaited<ReturnType<typeof extractRecipeSheetFromImage>> | null = null;
    try {
      extracted = await extractRecipeSheetFromImage(buffer, 'image/webp');
    } catch (visionErr) {
      console.warn('[meal-sheet preview] Vision failed (non-blocking):', visionErr);
    }

    // Fallback macros : Vision n'a pas trouve les macros sur la
    // fiche → on demande a Mistral d'estimer a partir de la liste
    // des ingredients + servings. Karine peut toujours corriger
    // dans le tableau de relecture.
    let proteinsG = extracted?.proteinsG ?? null;
    let lipidsG = extracted?.lipidsG ?? null;
    let carbsG = extracted?.carbsG ?? null;
    let calories = extracted?.calories ?? null;
    const ingredients = extracted?.ingredients ?? [];
    const servings = extracted?.servings ?? null;

    const macrosIncomplete =
      proteinsG === null || lipidsG === null || carbsG === null;
    if (macrosIncomplete && ingredients.length > 0) {
      const estimated = await estimateMacrosFromIngredients(
        ingredients,
        servings ?? 4,
        calories,
      );
      if (proteinsG === null) proteinsG = estimated.proteinsG;
      if (lipidsG === null) lipidsG = estimated.lipidsG;
      if (carbsG === null) carbsG = estimated.carbsG;
      if (calories === null) calories = estimated.caloriesPerServing;
    }

    return NextResponse.json({
      tempPath,
      imageUrl,
      title: extracted?.title ?? null,
      servings,
      calories,
      proteinsG,
      lipidsG,
      carbsG,
      prepTimeMin: extracted?.prepTimeMin ?? null,
      cookTimeMin: extracted?.cookTimeMin ?? null,
      tags: extracted?.tags ?? [],
      aliments: extracted?.aliments ?? [],
      ingredients,
    });
  } catch (e) {
    console.error('[admin/menus meal-sheet/preview] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
