import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

const BUCKET = 'content-images';

type AssetType = 'cover' | 'slide' | 'prep';
const ALLOWED: AssetType[] = ['cover', 'slide', 'prep'];

function sanitizeExt(ext: string, fallback = 'jpg'): string {
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  return cleaned || fallback;
}

async function uploadImage(
  supabase: ReturnType<typeof createServiceClient>,
  slug: string,
  name: string,
  file: File,
): Promise<string> {
  const rawExt = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
  const ext = sanitizeExt(
    rawExt,
    file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
      ? 'webp'
      : file.type === 'image/heic'
      ? 'heic'
      : 'jpg',
  );
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const path = `recipes/${slug}/${safeName}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (error) {
    console.error('[recipes asset POST] Storage error:', {
      originalName: file.name,
      size: file.size,
      type: file.type,
      path,
      error,
    });
    throw error;
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * POST 1 image et append à la colonne tableau correspondante.
 *   - type=cover  → remplace cover_image_url (cas rare, normalement déjà set à la création)
 *   - type=slide  → append à `slides[]`
 *   - type=prep   → append à `prep_photos[]`
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
    const type = String(form.get('type') || '') as AssetType;
    const file = form.get('file') as File | null;

    if (!ALLOWED.includes(type))
      return NextResponse.json({ error: 'Type d’asset invalide' }, { status: 400 });
    if (!file || file.size === 0)
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });

    const supabase = createServiceClient();

    // Vérif que la recette existe
    const { data: recipe, error: rdErr } = await supabase
      .from('recipes')
      .select('slug, slides, prep_photos, cover_image_url')
      .eq('slug', slug)
      .maybeSingle();
    if (rdErr) throw rdErr;
    if (!recipe) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 });

    // Nom + chemin selon le type
    const baseName =
      type === 'cover'
        ? `cover-${Date.now().toString(36)}`
        : type === 'slide'
        ? `slide-${Date.now().toString(36)}`
        : `prep-${Date.now().toString(36)}`;
    const url = await uploadImage(supabase, slug, baseName, file);

    // Update DB selon le type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = recipe as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let update: any;
    if (type === 'cover') {
      update = { cover_image_url: url };
    } else if (type === 'slide') {
      update = { slides: [...((r.slides as string[]) ?? []), url] };
    } else {
      update = { prep_photos: [...((r.prep_photos as string[]) ?? []), url] };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await supabase.from('recipes').update(update as any).eq('slug', slug);
    if (upErr) throw upErr;

    return NextResponse.json({ ok: true, url });
  } catch (e) {
    console.error('[recipes asset POST] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
