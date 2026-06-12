import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { extractRecipeSheetFromImage } from '@/lib/claude-recipe-vision';

const BUCKET = 'content-images';
// Runtime Node.js explicite : la limite du body est plus permissive
// qu'en Edge (4.5 MB → ~50+ MB en Node), ce qui évite l'erreur
// "Failed to parse body as FormData" sur les uploads de 5-10 photos.
export const runtime = 'nodejs';
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
  // Parse séparément pour donner un message clair sur les uploads trop
  // gros (cause typique : 10 photos × 5 MB = 50 MB, dépasse la limite).
  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    const msg = 'Erreur serveur';
    return NextResponse.json(
      {
        error: /failed to parse|body|size/i.test(msg)
          ? 'Upload trop volumineux. Réduis la taille ou le nombre d\'images (essaye 3-4 à la fois maxi).'
          : `Erreur de lecture du formulaire : ${msg || 'inconnue'}`,
      },
      { status: 413 },
    );
  }
  try {
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

    // Process SÉQUENTIEL (queue 1 par 1) :
    //  - Évite le rate limit Anthropic (parallèle 10x = risque 429)
    //  - Erreurs isolables (on sait quelle fiche a planté)
    //  - L'upload Storage et Vision Claude se font dans l'ordre des
    //    fichiers reçus → cohérence d'extraction
    // Trade-off : plus lent (somme des durées au lieu du max), mais
    // pour 1-10 fiches c'est négligeable (10 × ~2s = 20s acceptable).
    const results: Array<
      | {
          ok: true;
          fileName: string;
          tempPath: string;
          imageUrl: string;
          sheetNumber: number | null;
          title: string | null;
          servings: number | null;
          calories: number | null;
          prepTimeMin: number | null;
          cookTimeMin: number | null;
          tags: string[];
          aliments: string[];
          ingredients: unknown[];
        }
      | { ok: false; fileName: string; error: string }
    > = [];

    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
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

        results.push({
          ok: true,
          fileName: file.name,
          tempPath,
          imageUrl,
          sheetNumber: extracted?.sheetNumber ?? null,
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
        results.push({
          ok: false,
          fileName: file.name,
          error: 'Erreur serveur',
        });
      }
    }

    return NextResponse.json({ sheets: results });
  } catch (e) {
    console.error('[admin/recipes sheets-preview-bulk] error:', e);
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
