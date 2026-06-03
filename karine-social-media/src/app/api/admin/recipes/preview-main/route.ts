import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { extractRecipeSheetFromImage } from '@/lib/claude-recipe-vision';

const BUCKET = 'content-images';
export const maxDuration = 60;

/**
 * POST /api/admin/recipes/preview-main
 *
 * Reçoit l'image principale d'une NOUVELLE recette (pas encore créée
 * en DB). Upload en temp + Vision Haiku 4.5 full extract. Renvoie les
 * données pour pré-remplir le form de création unifié.
 *
 * Le client conserve `tempPath` en state et l'envoie au moment du save
 * final (POST /api/admin/recipes) qui déplace l'image vers son
 * emplacement définitif.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'Fichier image requis.' }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image trop grosse (max 10 Mo).' }, { status: 400 });
    }

    const { buffer, contentType } = await optimizeUploadToWebp(file);
    const supabase = createServiceClient();

    const tempPath = `temp-recipe-main/${Date.now().toString(36)}-${Math.random()
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
      console.warn('[preview-main] Vision failed (non-blocking):', visionErr);
    }

    return NextResponse.json({
      tempPath,
      imageUrl,
      title: extracted?.title ?? null,
      servings: extracted?.servings ?? null,
      calories: extracted?.calories ?? null,
      prepTimeMin: extracted?.prepTimeMin ?? null,
      cookTimeMin: extracted?.cookTimeMin ?? null,
      tags: extracted?.tags ?? [],
      aliments: extracted?.aliments ?? [],
      ingredients: extracted?.ingredients ?? [],
    });
  } catch (e) {
    console.error('[admin/recipes preview-main] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
