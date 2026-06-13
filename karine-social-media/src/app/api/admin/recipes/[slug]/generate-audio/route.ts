import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { textToSpeech } from '@/lib/elevenlabs';
import { parsePreparationSteps } from '@/data/recipes';

// Bucket dédié audio : `content-images` restreint les MIME aux images
// (rejette audio/mpeg). `recipe-audio` est public et autorise l'audio.
const BUCKET = 'recipe-audio';
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

    // Assure l'existence ET la publicité du bucket audio (idempotent).
    // createBucket crée si absent ; updateBucket force public + audio même
    // si le bucket existait déjà en privé (sinon l'URL publique ne sert pas
    // → "The element has no supported sources" côté lecteur).
    await supabase.storage.createBucket(BUCKET, {
      public: true,
      allowedMimeTypes: ['audio/mpeg', 'audio/mp3'],
    });
    await supabase.storage.updateBucket(BUCKET, {
      public: true,
      allowedMimeTypes: ['audio/mpeg', 'audio/mp3'],
    });

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

    let generated = 0;
    let skipped = 0;
    let total = 0;
    const errors: string[] = [];
    // Chemin horodaté unique (pattern Hero) : chaque génération produit une
    // NOUVELLE URL → jamais cachée en erreur par le CDN Supabase (contrairement
    // à un chemin fixe + ?v= généré quand le bucket était encore privé).
    const ts = Date.now();

    // Séquentiel sur fiches puis étapes : évite de saturer ElevenLabs.
    for (const sheet of (sheets ?? []) as { id: string; preparation_steps: unknown }[]) {
      const steps = parsePreparationSteps(sheet.preparation_steps);
      if (steps.length === 0) continue;
      total += steps.length;

      let changed = false;
      for (let i = 0; i < steps.length; i++) {
        // Skip : étape déjà sonorisée (batch). Évite de re-payer ElevenLabs.
        const existing = steps[i].audioUrl;
        if (skipExisting && typeof existing === 'string' && existing.trim()) {
          skipped++;
          continue;
        }
        try {
          const mp3 = await textToSpeech(steps[i].text, voiceId);
          const path = `${sheet.id}/step-${i}-${ts}.mp3`;
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(path, mp3, { contentType: 'audio/mpeg', upsert: true });
          if (upErr) throw upErr;
          // URL publique propre (sans query) — le chemin est déjà unique.
          const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
          steps[i].audioUrl = data.publicUrl;
          generated++;
          changed = true;
        } catch (e) {
          errors.push(
            `fiche ${sheet.id} étape ${i + 1}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      // N'écrit la fiche que si au moins un audio a été (re)généré.
      if (changed) {
        const { error: updErr } = await (supabase as any)
          .from('recipe_sheets')
          .update({ preparation_steps: steps })
          .eq('id', sheet.id);
        if (updErr) errors.push(`update fiche ${sheet.id}: ${updErr.message}`);
      }
    }

    return NextResponse.json({ ok: true, generated, skipped, total, errors });
  } catch (e) {
    console.error('[recipe generate-audio] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
