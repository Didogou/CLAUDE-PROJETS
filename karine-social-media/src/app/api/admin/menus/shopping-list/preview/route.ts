import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { extractShoppingListFromImage } from '@/lib/claude-vision';

const BUCKET = 'content-images';

// Vision peut prendre 5-15s sur une image complexe.
export const maxDuration = 60;

/**
 * Variante "preview" de l'extraction : utilisée DANS LA PAGE DE CRÉATION
 * d'un menu, quand on n'a pas encore de menuId.
 *
 * Workflow :
 *  1. Reçoit le fichier image
 *  2. L'optimise en WebP
 *  3. Upload dans `temp-shopping/{timestamp-rand}.webp` (zone temporaire)
 *  4. Appelle Claude Vision pour extraire { portions, items }
 *  5. Renvoie { tempPath, imageUrl, portions, items } au client
 *
 * Le tempPath sera ensuite envoyé au POST /api/admin/menus à la création,
 * qui déplacera le fichier vers `menus/{newId}/shopping-{ts}.webp` et
 * sauvera shopping_list_image_url + portions + items en une seule fois.
 *
 * Les fichiers temp peuvent pourrir si l'admin abandonne avant submit —
 * cleanup périodique côté Storage si besoin (rare en V1).
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
      return NextResponse.json(
        { error: 'Image trop grosse (max 10 Mo).' },
        { status: 400 },
      );
    }

    const { buffer, contentType } = await optimizeUploadToWebp(file);
    const supabase = createServiceClient();

    // Chemin temp : timestamp + random pour éviter collisions concurrentes
    const tempPath = `temp-shopping/${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}.webp`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(tempPath, buffer, { upsert: true, contentType });
    if (upErr) throw upErr;
    const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(tempPath).data.publicUrl;

    const extracted = await extractShoppingListFromImage(buffer, 'image/webp');

    return NextResponse.json({
      tempPath,
      imageUrl,
      portions: extracted.portions,
      items: extracted.items,
    });
  } catch (e) {
    console.error('[admin/menus shopping-list/preview] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
