import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { extractPreparationForSheets } from '@/lib/sheet-preparation';

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

    // Cœur partagé (cf. src/lib/sheet-preparation.ts) — même logique pour
    // les fiches recette et les fiches repas de menu.
    const result = await extractPreparationForSheets(
      supabase,
      'recipe_sheets',
      (sheets ?? []) as { id: string; cover_image_url: string; preparation_steps: unknown }[],
      skipExisting,
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[admin/recipes extract-preparation] error:', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
