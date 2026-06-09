import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { createServiceClient } from '@/lib/supabase/server';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { checkImageUpload } from '@/lib/validate-upload';

export const runtime = 'nodejs';

const BUCKET = 'avatars';

/** POST multipart : { file } → upload + update profiles.avatar_url. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Formulaire invalide' }, { status: 400 });
  }
  const file = form.get('file');
  // Cap 5 MB AVANT arrayBuffer + vérif magic bytes (file.type spoofable).
  const check = await checkImageUpload(file, { maxBytes: 5 * 1024 * 1024 });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  // Conversion WebP (qualité 85) + resize 512 max (variant icon)
  const { buffer, ext, contentType } = await optimizeUploadToWebp(file as File, {
    icon: true,
  });
  const supabase = createServiceClient();
  const path = `${user.id}/${Date.now().toString(36)}.${ext}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await (supabase.storage as any)
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: false });
  if (upErr) {
    return NextResponse.json({ error: `Upload échoué : ${upErr.message}` }, { status: 500 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = (supabase.storage as any).from(BUCKET).getPublicUrl(path).data.publicUrl as string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', user.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, url });
}

/** DELETE : retire l'avatar (remet à null en DB). */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  }
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
