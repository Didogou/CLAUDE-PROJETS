import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { extractRecipeSheetFromImage } from '@/lib/claude-recipe-vision';

const BUCKET = 'content-images';
export const maxDuration = 60;

/**
 * POST /api/admin/recipes/[slug]/sheets/preview
 *
 * Reçoit l'image d'une fiche détaillée, l'upload en temp, lance Vision
 * Haiku 4.5 et renvoie les données extraites pour que Karine puisse
 * valider/corriger avant d'enregistrer.
 *
 * Renvoie : { tempPath, imageUrl, title, servings, calories,
 *             prepTimeMin, cookTimeMin, tags, aliments, ingredients }
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug } = await ctx.params;
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

    const tempPath = `temp-recipe-sheets/${slug}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}.webp`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(tempPath, buffer, { upsert: true, contentType });
    if (upErr) throw upErr;
    const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(tempPath).data.publicUrl;

    const extracted = await extractRecipeSheetFromImage(buffer, 'image/webp');

    return NextResponse.json({
      tempPath,
      imageUrl,
      ...extracted,
    });
  } catch (e) {
    console.error('[admin/recipes sheets/preview] error:', e);
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
