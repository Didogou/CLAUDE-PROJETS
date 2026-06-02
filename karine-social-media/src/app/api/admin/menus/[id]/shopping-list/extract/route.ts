import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { extractShoppingListFromImage } from '@/lib/claude-vision';

const BUCKET = 'content-images';

// Vision peut prendre 5-15s sur une image complexe. Next 16 timeout par
// défaut suffit sur Vercel hobby (60s), mais on cap explicitement.
export const maxDuration = 60;

/**
 * Reçoit une image "liste de courses" et :
 *  1. La convertit en WebP optimisé
 *  2. L'upload dans Storage (bucket content-images)
 *  3. Met à jour weekly_menus.shopping_list_image_url
 *  4. Appelle Claude Vision pour extraire { portions, items }
 *  5. Renvoie { imageUrl, portions, items } au client
 *
 * L'admin verra ensuite un écran de prévisualisation éditable et POSTera
 * vers /api/admin/menus/[id]/shopping-list pour persister la liste validée.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
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

    // 1+2 : optimisation + upload Storage
    const { buffer, contentType } = await optimizeUploadToWebp(file);
    const supabase = createServiceClient();
    const storagePath = `menus/${id}/shopping-${Date.now().toString(36)}.webp`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { upsert: true, contentType });
    if (upErr) throw upErr;
    const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data
      .publicUrl;

    // 3 : update colonne image (sans toucher portions/items, ce sera l'étape PUT)
    const { error: updErr } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('weekly_menus' as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ shopping_list_image_url: imageUrl } as any)
      .eq('id', id);
    if (updErr) throw updErr;

    // 4 : Claude Vision
    const extracted = await extractShoppingListFromImage(buffer, 'image/webp');

    // 5 : retour client
    return NextResponse.json({
      imageUrl,
      portions: extracted.portions,
      items: extracted.items,
    });
  } catch (e) {
    console.error('[admin/menus shopping-list/extract] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
