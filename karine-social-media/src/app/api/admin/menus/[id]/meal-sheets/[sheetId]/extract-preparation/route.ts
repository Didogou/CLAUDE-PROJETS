import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { extractPreparationForSheets } from '@/lib/sheet-preparation';

// Re-Vision d'une fiche repas → peut être long.
export const maxDuration = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/admin/menus/[id]/meal-sheets/[sheetId]/extract-preparation
 *
 * Extrait (Claude Vision) preparation_steps + utensils d'UNE fiche repas
 * de menu depuis son image. Même cœur que la route recette
 * (src/lib/sheet-preparation.ts), paramétré sur menu_meal_sheets.
 *
 * Body : { skipExisting?: boolean }  (défaut false → re-extrait)
 * Renvoie { ok, processed, updated, skipped, errors }.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; sheetId: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { sheetId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const skipExisting = body?.skipExisting === true;
    const supabase = createServiceClient() as any;

    const { data: sheet, error } = await supabase
      .from('menu_meal_sheets')
      .select('id, cover_image_url, preparation_steps')
      .eq('id', sheetId)
      .maybeSingle();
    if (error) throw error;
    if (!sheet) {
      return NextResponse.json({ error: 'Fiche repas introuvable.' }, { status: 404 });
    }

    const result = await extractPreparationForSheets(
      supabase,
      'menu_meal_sheets',
      [sheet],
      skipExisting,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[admin/menus extract-preparation] error:', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
