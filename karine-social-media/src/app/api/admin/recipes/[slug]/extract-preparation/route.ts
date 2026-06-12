import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { extractRecipeSheetFromImage } from '@/lib/claude-recipe-vision';
import { upsertUtensils } from '@/lib/utensils';

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
 * Renvoie { ok, processed, updated, errors }.
 */
export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug } = await ctx.params;
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
      .select('id, cover_image_url')
      .eq('recipe_id', (recipe as { id: number }).id)
      .order('sheet_index', { ascending: true });
    if (sheetsErr) throw sheetsErr;

    const rows = (sheets ?? []) as { id: string; cover_image_url: string }[];
    let processed = 0;
    let updated = 0;
    const errors: string[] = [];

    // Séquentiel : évite de saturer l'API Vision + reste prévisible.
    for (const sheet of rows) {
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
            preparation_steps: extracted.preparationSteps,
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

    return NextResponse.json({ ok: true, processed, updated, errors });
  } catch (e) {
    console.error('[admin/recipes extract-preparation] error:', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
