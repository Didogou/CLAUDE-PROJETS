import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { moderatePhoto } from '@/lib/moderation';

const BUCKET = 'content-images';
const MAX_PHOTOS = 2;

async function uploadPhoto(
  supabase: ReturnType<typeof createServiceClient>,
  commentId: string,
  index: number,
  file: File,
): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `comments/${commentId}/photo-${index}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await ctx.params;
    const form = await request.formData();

    const body = String(form.get('body') || '').trim();
    const author = String(form.get('authorName') || '').trim();
    const parentId = String(form.get('parentId') || '').trim() || null;
    const photoFiles = form
      .getAll('photos')
      .filter((s): s is File => s instanceof File && s.size > 0)
      .slice(0, MAX_PHOTOS);

    if (!body) return NextResponse.json({ error: 'Avis vide' }, { status: 400 });
    if (body.length > 1000)
      return NextResponse.json({ error: 'Avis trop long (max 1000 caractères)' }, { status: 400 });

    const supabase = createServiceClient();

    // Vérif que l'astuce existe
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tip } = await (supabase as any)
      .from('tips')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();
    if (!tip) return NextResponse.json({ error: 'Astuce introuvable' }, { status: 404 });

    // Vérif que le parent (si fourni) existe ET concerne la même astuce
    if (parentId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: parent } = await (supabase.from('comments' as any) as any)
        .select('id, tip_slug')
        .eq('id', parentId)
        .maybeSingle();
      if (!parent || (parent as { tip_slug: string }).tip_slug !== slug)
        return NextResponse.json({ error: 'Commentaire parent introuvable' }, { status: 400 });
    }

    // Modération photos AVANT toute insertion / upload (rejet rapide si NSFW)
    for (const photo of photoFiles) {
      const verdict = await moderatePhoto(photo);
      if (!verdict.safe) {
        return NextResponse.json(
          { error: verdict.reason ?? 'Photo refusée par la modération' },
          { status: 400 },
        );
      }
    }

    // 1. Insert le commentaire (sans photos)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: created, error } = await (supabase.from('comments' as any) as any)
      .insert({
        tip_slug: slug,
        author_name: author || 'Anonyme',
        body,
        parent_id: parentId,
      })
      .select()
      .single();
    if (error) throw error;

    // 2. Upload photos si fournies + update
    const photoUrls: string[] = [];
    if (photoFiles.length > 0) {
      for (let i = 0; i < photoFiles.length; i++) {
        photoUrls.push(await uploadPhoto(supabase, created.id, i + 1, photoFiles[i]));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.from('comments' as any) as any)
        .update({ photos: photoUrls })
        .eq('id', created.id);
      if (upErr) throw upErr;
    }

    return NextResponse.json({
      id: created.id,
      authorName: created.author_name,
      body: created.body,
      photos: photoUrls,
      likesCount: 0,
      parentId: created.parent_id,
      createdAt: created.created_at,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
