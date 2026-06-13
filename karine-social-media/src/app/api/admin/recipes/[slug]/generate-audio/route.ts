import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { generateAudioForSheets } from '@/lib/sheet-audio';

// TTS séquentiel sur TOUTES les fiches × TOUTES les étapes → long.
export const maxDuration = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/admin/recipes/[slug]/generate-audio
 * Body : { voiceId?: string, skipExisting?: boolean }
 *
 * Génère la voix ElevenLabs de CHAQUE étape de CHAQUE fiche de la recette
 * (avec la voix choisie), upload les mp3 et écrit `audioUrl` dans le jsonb
 * preparation_steps de chaque fiche.
 *
 * skipExisting=true → ignore les étapes qui ont DÉJÀ un audioUrl (utilisé
 * par le batch pour ne pas re-payer ElevenLabs). Défaut false (régénère
 * tout, comportement du bouton par-recette).
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
    const voiceId =
      typeof body?.voiceId === 'string' && body.voiceId.trim()
        ? body.voiceId.trim()
        : undefined;
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

    const { data: sheets, error } = await (supabase as any)
      .from('recipe_sheets')
      .select('id, preparation_steps')
      .eq('recipe_id', (recipe as { id: number }).id)
      .order('sheet_index', { ascending: true });
    if (error) throw error;

    // Cœur partagé (cf. src/lib/sheet-audio.ts) — même logique pour les
    // fiches recette et les fiches repas de menu.
    const result = await generateAudioForSheets(
      supabase,
      'recipe_sheets',
      (sheets ?? []) as { id: string; preparation_steps: unknown }[],
      voiceId,
      skipExisting,
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[recipe generate-audio] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
