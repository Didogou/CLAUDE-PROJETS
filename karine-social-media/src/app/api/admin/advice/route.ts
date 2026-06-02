import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';

const BUCKET = 'content-images';

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function uploadImage(
  supabase: ReturnType<typeof createServiceClient>,
  slug: string,
  name: string,
  file: File,
): Promise<string> {
  // Conversion WebP (qualité 85) systématique avant upload Storage
  const { buffer, ext, contentType } = await optimizeUploadToWebp(file);
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const path = `advice/${slug}/${safeName}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: true, contentType });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Création : on accepte UNIQUEMENT label + tags + status + 1ère image (cover).
// Les slides suivantes sont uploadées via POST /api/admin/tips/[slug]/slide.
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const form = await request.formData();
    const label = String(form.get('label') || '').trim();
    const status = String(form.get('status') || 'draft');
    const tags = splitList(form.get('tags') as string | null);
    const cover = form.get('cover') as File | null;

    if (!label) return NextResponse.json({ error: 'Label requis' }, { status: 400 });
    if (!['draft', 'published'].includes(status))
      return NextResponse.json({ error: 'Status invalide' }, { status: 400 });
    if (!cover || cover.size === 0)
      return NextResponse.json({ error: 'Image requise' }, { status: 400 });

    const supabase = createServiceClient();

    let slug = slugify(label) || `conseil-${Date.now().toString(36)}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any)
      .from('health_advice')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();
    if (existing) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const coverUrl = await uploadImage(supabase, slug, 'cover', cover);

    const insertPayload = {
      slug,
      label,
      slides: [coverUrl],
      tags,
      status,
      published_at: status === 'published' ? new Date().toISOString() : null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('health_advice').insert(insertPayload);
    if (error) throw error;

    return NextResponse.json({ ok: true, slug });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
