import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { generateAudioForSheets } from '@/lib/sheet-audio';

// TTS séquentiel sur toutes les étapes de la fiche → peut être long.
export const maxDuration = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/admin/menus/[id]/meal-sheets/[sheetId]/generate-audio
 *
 * Génère la voix (ElevenLabs) de chaque étape d'UNE fiche repas de menu.
 * Même cœur que la route recette (src/lib/sheet-audio.ts), paramétré sur
 * menu_meal_sheets. Bucket `recipe-audio` partagé.
 *
 * Body : { voiceId?: string, skipExisting?: boolean }
 * Renvoie { ok, generated, skipped, total, errors }.
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
    const voiceId =
      typeof body?.voiceId === 'string' && body.voiceId.trim()
        ? body.voiceId.trim()
        : undefined;
    const skipExisting = body?.skipExisting === true;
    const supabase = createServiceClient() as any;

    const { data: sheet, error } = await supabase
      .from('menu_meal_sheets')
      .select('id, preparation_steps')
      .eq('id', sheetId)
      .maybeSingle();
    if (error) throw error;
    if (!sheet) {
      return NextResponse.json({ error: 'Fiche repas introuvable.' }, { status: 404 });
    }

    const result = await generateAudioForSheets(
      supabase,
      'menu_meal_sheets',
      [sheet],
      voiceId,
      skipExisting,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[admin/menus generate-audio] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
