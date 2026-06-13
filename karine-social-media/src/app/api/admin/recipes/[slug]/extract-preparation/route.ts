import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { extractRecipeSheetFromImage } from '@/lib/claude-recipe-vision';
import { upsertUtensils, sanitizePreparationSteps } from '@/lib/utensils';
import { parsePreparationSteps } from '@/data/recipes';

// Re-Vision de N fiches séquentiellement → peut être long.
export const maxDuration = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/admin/recipes/[slug]/extract-preparation
 *
 * Rattrapage pour les recettes DÉJÀ uploadées (avant l'extraction
 * préparation + ustensiles). Pour chaque fiche de la recette :
 *   1. re-télécharge son image (cover_image_url)
 *   2. relance Vision
 *   3. met à jour UNIQUEMENT preparation_steps + utensils
 *      (n'écrase PAS ingrédients / macros / titre déjà validés)
 *
 * Body : { skipExisting?: boolean }
 *   - skipExisting=true → ignore les fiches qui ont DÉJÀ des étapes
 *     (preparation_steps non vide). Utilisé par le batch pour ne pas
 *     re-payer Vision ni écraser des corrections manuelles. Défaut false
 *     (les boutons par-recette gardent le comportement « re-extraire »).
 *
 * Renvoie { ok, processed, updated, skipped, errors }.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const skipExisting = body?.skipExisting === true;
    const supabase = createServiceClient();

    const { data: recipe } = await supabase
      .from('recipes')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (!recipe) {
      return NextResponse.json({ error: 'Recette introuvable.' }, { status: 404 });
    }

    const { data: sheets, error: sheetsErr } = await (supabase as any)
      .from('recipe_sheets')
      .select('id, cover_image_url, preparation_steps')
      .eq('recipe_id', (recipe as { id: number }).id)
      .order('sheet_index', { ascending: true });
    if (sheetsErr) throw sheetsErr;

    const rows = (sheets ?? []) as {
      id: string;
      cover_image_url: string;
      preparation_steps: unknown;
    }[];
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Séquentiel : évite de saturer l'API Vision + reste prévisible.
    for (const sheet of rows) {
      // Skip : fiche déjà extraite (batch). Évite Vision + écrasement manuel.
      if (skipExisting && parsePreparationSteps(sheet.preparation_steps).length > 0) {
        skipped++;
        continue;
      }
      processed++;
      try {
        const imgRes = await fetch(sheet.cover_image_url);
        if (!imgRes.ok) throw new Error(`image ${imgRes.status}`);
        const buffer = Buffer.from(await imgRes.arrayBuffer());

        const extracted = await extractRecipeSheetFromImage(buffer, 'image/webp');
        const utensilSlugs = await upsertUtensils(supabase, extracted.utensils);

        const { error: updErr } = await (supabase as any)
          .from('recipe_sheets')
          .update({
            preparation_steps: sanitizePreparationSteps(extracted.preparationSteps),
            utensils: utensilSlugs,
          })
          .eq('id', sheet.id);
        if (updErr) throw updErr;
        updated++;
      } catch (e) {
        errors.push(
          `${sheet.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return NextResponse.json({ ok: true, processed, updated, skipped, errors });
  } catch (e) {
    console.error('[admin/recipes extract-preparation] error:', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
