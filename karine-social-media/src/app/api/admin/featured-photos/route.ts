import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { createServiceClient } from '@/lib/supabase/server';
import {
  createFeaturedPhoto,
  deleteFeaturedPhoto,
  updateFeaturedPhoto,
} from '@/lib/featured-photos';

export const runtime = 'nodejs';

const BUCKET = 'featured-photos';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/** POST : upload + insert. Form-data { file, caption } */
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

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Aucun fichier fourni' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Fichier vide ou trop volumineux (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 400 },
    );
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json(
      { error: 'Type de fichier non supporté (images uniquement)' },
      { status: 400 },
    );
  }

  const caption = form.get('caption');
  const captionStr =
    typeof caption === 'string' && caption.trim().length > 0
      ? caption.trim().slice(0, 200)
      : null;

  // Upload Supabase Storage
  const supabase = createServiceClient();
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: uploadError } = await (supabase.storage as any)
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    return NextResponse.json(
      { error: `Upload échoué : ${uploadError.message}` },
      { status: 500 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pub } = (supabase.storage as any)
    .from(BUCKET)
    .getPublicUrl(path);
  const imageUrl = pub?.publicUrl as string | undefined;
  if (!imageUrl) {
    return NextResponse.json(
      { error: 'Impossible de calculer l’URL publique' },
      { status: 500 },
    );
  }

  const created = await createFeaturedPhoto({
    imageUrl,
    caption: captionStr,
    adminId: user.id,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.reason }, { status: 500 });
  }
  return NextResponse.json({ ok: true, photo: created.photo });
}

/** PATCH : update caption / published / sort_order */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id || !user.isAdmin) {
    return NextResponse.json({ error: 'Réservé à l’admin' }, { status: 403 });
  }

  let payload: {
    id?: number;
    caption?: string | null;
    published?: boolean;
    sortOrder?: number;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const id = Number(payload.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const patch: Parameters<typeof updateFeaturedPhoto>[0]['patch'] = {};
  if (payload.caption !== undefined) {
    patch.caption =
      typeof payload.caption === 'string'
        ? payload.caption.trim().slice(0, 200) || null
        : null;
  }
  if (typeof payload.published === 'boolean') patch.published = payload.published;
  if (typeof payload.sortOrder === 'number') patch.sortOrder = payload.sortOrder;

  const r = await updateFeaturedPhoto({ id, patch });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE : ?id=... */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id || !user.isAdmin) {
    return NextResponse.json({ error: 'Réservé à l’admin' }, { status: 403 });
  }
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }
  const r = await deleteFeaturedPhoto(id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
  return NextResponse.json({ ok: true });
}
