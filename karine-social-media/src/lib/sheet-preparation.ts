import 'server-only';
import { extractRecipeSheetFromImage } from '@/lib/claude-recipe-vision';
import { upsertUtensils, sanitizePreparationSteps } from '@/lib/utensils';
import { parsePreparationSteps } from '@/data/recipes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cœur PARTAGÉ de l'extraction préparation + ustensiles (Claude Vision),
 * paramétré par table. Utilisé par les routes recette ET menu (« les
 * fiches sont les mêmes »). Reçoit le client supabase en paramètre →
 * testable hors Next.
 *
 * Pour chaque fiche : (skip si déjà extraite & skipExisting) sinon
 * re-télécharge l'image → Vision → upsert ustensiles → met à jour
 * UNIQUEMENT preparation_steps + utensils de la table cible.
 */
export type SheetTable = 'recipe_sheets' | 'menu_meal_sheets';

export type PrepRow = {
  id: string;
  cover_image_url: string;
  preparation_steps: unknown;
};

export type ExtractResult = {
  processed: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export async function extractPreparationForSheets(
  supabase: any,
  table: SheetTable,
  rows: PrepRow[],
  skipExisting: boolean,
): Promise<ExtractResult> {
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Séquentiel : évite de saturer l'API Vision + reste prévisible.
  for (const sheet of rows) {
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

      const { error } = await supabase
        .from(table)
        .update({
          preparation_steps: sanitizePreparationSteps(extracted.preparationSteps),
          utensils: utensilSlugs,
        })
        .eq('id', sheet.id);
      if (error) throw error;
      updated++;
    } catch (e) {
      errors.push(`${sheet.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { processed, updated, skipped, errors };
}
