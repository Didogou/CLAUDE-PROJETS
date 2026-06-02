import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { createServiceClient } from '@/lib/supabase/server';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { upsertBackground } from '@/lib/background-images';
import type { BackgroundVariantKey } from '@/data/background-images';

export const runtime = 'nodejs';

const VARIANTS: BackgroundVariantKey[] = [
  'default',
  'astuces',
  'conseils',
  'salade',
  'dessert',
  'accueil',
];

const BUCKET = 'content-images';

/**
 * POST /api/admin/background-images
 *   - multipart/form-data : variant, kind (portrait|paysage), file
 *   - Convertit en WebP qualité 85 (1920px max paysage), upload Storage,
 *     met à jour la table background_images.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id || !user.isAdmin) {
    return NextResponse.json({ error: 'Réservé à l’admin' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Formulaire invalide' }, { status: 400 });
  }

  const variant = form.get('variant') as string | null;
  const kind = form.get('kind') as string | null;
  const file = form.get('file');

  if (!variant || !VARIANTS.includes(variant as BackgroundVariantKey)) {
    return NextResponse.json({ error: 'variant invalide' }, { status: 400 });
  }
  if (kind !== 'portrait' && kind !== 'paysage') {
    return NextResponse.json({ error: 'kind invalide (portrait|paysage)' }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Fichier requis' }, { status: 400 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Type non supporté (image uniquement)' }, { status: 400 });
  }

  // Conversion WebP qualité 85 + resize
  const { buffer, ext, contentType } = await optimizeUploadToWebp(file);
  const supabase = createServiceClient();
  const path = `backgrounds/${variant}/${kind}-${Date.now().toString(36)}.${ext}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await (supabase.storage as any)
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: false });
  if (upErr) {
    return NextResponse.json({ error: `Upload échoué : ${upErr.message}` }, { status: 500 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = (supabase.storage as any).from(BUCKET).getPublicUrl(path).data.publicUrl as string;

  const patch: { portraitUrl?: string; paysageUrl?: string } = {};
  if (kind === 'portrait') patch.portraitUrl = url;
  else patch.paysageUrl = url;

  const r = await upsertBackground({
    variant: variant as BackgroundVariantKey,
    ...patch,
    adminId: user.id,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.reason }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url });
}

/**
 * DELETE /api/admin/background-images?variant=...&kind=portrait|paysage
 * Remet le fond personnalisé à null (l'app retombe sur le fichier livré).
 */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id || !user.isAdmin) {
    return NextResponse.json({ error: 'Réservé à l’admin' }, { status: 403 });
  }

  const url = new URL(req.url);
  const variant = url.searchParams.get('variant');
  const kind = url.searchParams.get('kind');
  if (!variant || !VARIANTS.includes(variant as BackgroundVariantKey)) {
    return NextResponse.json({ error: 'variant invalide' }, { status: 400 });
  }
  if (kind !== 'portrait' && kind !== 'paysage') {
    return NextResponse.json({ error: 'kind invalide' }, { status: 400 });
  }

  const r = await upsertBackground({
    variant: variant as BackgroundVariantKey,
    ...(kind === 'portrait' ? { portraitUrl: null } : { paysageUrl: null }),
    adminId: user.id,
  });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
  return NextResponse.json({ ok: true });
}
