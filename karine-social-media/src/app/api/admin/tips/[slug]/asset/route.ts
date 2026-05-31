import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

const BUCKET = 'content-images';

function sanitizeExt(ext: string, fallback = 'jpg'): string {
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  return cleaned || fallback;
}

/**
 * POST 1 slide additionnelle à une astuce existante.
 * Permet l'upload incrémental côté form pour rester sous 4,5 MB / requête.
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
    if (!file || file.size === 0)
      return NextResponse.json({ error: 'Fichier requis' }, { status: 400 });

    const supabase = createServiceClient();

    const rawExt = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
    const ext = sanitizeExt(
      rawExt,
      file.type === 'image/png' ? 'png' :
      file.type === 'image/webp' ? 'webp' :
      file.type === 'image/heic' ? 'heic' :
      'jpg',
    );
    const name = `slide-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
    const path = `tips/${slug}/${name}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (upErr) throw upErr;
    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    // Append à la colonne slides[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current } = await (supabase as any)
      .from('tips')
      .select('slides')
      .eq('slug', slug)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: 'Astuce introuvable' }, { status: 404 });
    const newSlides = [...((current.slides as string[]) ?? []), url];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('tips')
      .update({ slides: newSlides })
      .eq('slug', slug);
    if (error) throw error;

    return NextResponse.json({ ok: true, url });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
