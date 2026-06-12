import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';

const BUCKET = 'content-images';

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

    // Conversion WebP (qualité 85) systématique avant upload Storage
    const { buffer, ext, contentType } = await optimizeUploadToWebp(file);
    const name = `slide-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
    const path = `tips/${slug}/${name}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { upsert: true, contentType });
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
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
