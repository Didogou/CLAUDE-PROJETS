import 'server-only';
import { textToSpeech } from '@/lib/elevenlabs';
import { parsePreparationSteps } from '@/data/recipes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cœur PARTAGÉ de la génération voix (ElevenLabs) par étape de
 * préparation, paramétré par table. Utilisé par les routes recette ET
 * menu. Reçoit le client supabase en paramètre → testable hors Next.
 *
 * Bucket `recipe-audio` (public). Chemin horodaté unique par génération
 * → jamais caché en erreur par le CDN. skipExisting=true ignore les
 * étapes déjà sonorisées. N'écrit la fiche que si un audio a changé.
 */
export type SheetTable = 'recipe_sheets' | 'menu_meal_sheets';

export type AudioRow = {
  id: string;
  preparation_steps: unknown;
};

export type AudioResult = {
  generated: number;
  skipped: number;
  total: number;
  errors: string[];
};

const BUCKET = 'recipe-audio';

export async function ensureAudioBucket(supabase: any): Promise<void> {
  // createBucket crée si absent ; updateBucket force public + audio même
  // si le bucket existait en privé (sinon URL publique inutilisable).
  await supabase.storage.createBucket(BUCKET, {
    public: true,
    allowedMimeTypes: ['audio/mpeg', 'audio/mp3'],
  });
  await supabase.storage.updateBucket(BUCKET, {
    public: true,
    allowedMimeTypes: ['audio/mpeg', 'audio/mp3'],
  });
}

export async function generateAudioForSheets(
  supabase: any,
  table: SheetTable,
  rows: AudioRow[],
  voiceId: string | undefined,
  skipExisting: boolean,
): Promise<AudioResult> {
  await ensureAudioBucket(supabase);

  let generated = 0;
  let skipped = 0;
  let total = 0;
  const errors: string[] = [];
  // Chemin horodaté unique (pattern Hero) partagé par l'appel.
  const ts = Date.now();

  for (const sheet of rows) {
    const steps = parsePreparationSteps(sheet.preparation_steps);
    if (steps.length === 0) continue;
    total += steps.length;

    let changed = false;
    for (let i = 0; i < steps.length; i++) {
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

    if (changed) {
      const { error: updErr } = await supabase
        .from(table)
        .update({ preparation_steps: steps })
        .eq('id', sheet.id);
      if (updErr) errors.push(`update fiche ${sheet.id}: ${updErr.message}`);
    }
  }

  return { generated, skipped, total, errors };
}
