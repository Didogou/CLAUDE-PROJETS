import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { extractRecipeSheetFromImage } from '@/lib/claude-recipe-vision';

const BUCKET = 'content-images';
// N images en parallèle peut prendre 30s+. Cap à 60s, limite Vercel hobby.
export const maxDuration = 60;

/**
 * POST /api/admin/recipes/sheets-preview-bulk
 *
 * Reçoit N images de fiches détaillées via formData (key="files",
 * multiple). Pour chacune : upload temp + Vision Haiku en parallèle.
 * Renvoie un array de previews.
 *
 * Limite : 10 images max par batch (sinon risque timeout).
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const form = await request.formData();
    const files = form
      .getAll('files')
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) {
      return NextResponse.json({ error: 'Aucune image fournie.' }, { status: 400 });
    }
    if (files.length > 10) {
      return NextResponse.json(
        { error: 'Maximum 10 images par batch (envoie en plusieurs fois).' },
        { status: 400 },
      );
    }
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: `Image trop grosse (${f.name}, max 10 Mo).` },
          { status: 400 },
        );
      }
    }

    const supabase = createServiceClient();

    // Process en parallèle (Vision + upload Storage indépendants par image)
    const results = await Promise.all(
      files.map(async (file, idx) => {
        try {
          const { buffer, contentType } = await optimizeUploadToWebp(file);
          const tempPath = `temp-recipe-sheets/${Date.now().toString(36)}-${idx}-${Math.random()
            .toString(36)
            .slice(2, 8)}.webp`;
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(tempPath, buffer, { upsert: true, contentType });
          if (upErr) throw upErr;
          const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(tempPath).data
            .publicUrl;

          let extracted: Awaited<ReturnType<typeof extractRecipeSheetFromImage>> | null = null;
          try {
            extracted = await extractRecipeSheetFromImage(buffer, 'image/webp');
          } catch (visionErr) {
            console.warn(`[bulk preview] Vision failed for ${file.name}:`, visionErr);
          }

          return {
            ok: true as const,
            fileName: file.name,
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
          };
        } catch (e) {
          return {
            ok: false as const,
            fileName: file.name,
            error: e instanceof Error ? e.message : 'Erreur',
          };
        }
      }),
    );

    return NextResponse.json({ sheets: results });
  } catch (e) {
    console.error('[admin/recipes sheets-preview-bulk] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
