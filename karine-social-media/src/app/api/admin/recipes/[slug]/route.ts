import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

// Cf. POST /recipes : cast d'appoint jusqu'à la regénération des types Supabase.

const BUCKET = 'content-images';

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

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
    file.type === 'image/png' ? 'png' :
    file.type === 'image/webp' ? 'webp' :
    file.type === 'image/heic' ? 'heic' :
    'jpg',
  );
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const path = `recipes/${slug}/${safeName}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (error) {
    console.error('[uploadImage PATCH] Storage error:', {
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

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug } = await ctx.params;
    const form = await request.formData();

    const title = String(form.get('title') || '').trim();
    const category = String(form.get('category') || '');
    const status = String(form.get('status') || 'draft');
    const caloriesRaw = String(form.get('calories') || '').trim();
    const tags = splitList(form.get('tags') as string | null);
    const aliments = splitList(form.get('aliments') as string | null);
    const isSeasonal = form.get('isSeasonal') === 'on' || form.get('isSeasonal') === 'true';
    const isFeatured = form.get('isFeatured') === 'on' || form.get('isFeatured') === 'true';
    const prepTimeRaw = String(form.get('prepTimeMin') || '').trim();
    const cookTimeRaw = String(form.get('cookTimeMin') || '').trim();

    if (!title) return NextResponse.json({ error: 'Titre requis' }, { status: 400 });
    if (!['petit_dejeuner', 'entree', 'salade', 'plat', 'sauce', 'gouter', 'dessert', 'boisson', 'aperitif', 'repas_fete'].includes(category))
      return NextResponse.json({ error: 'Catégorie invalide' }, { status: 400 });

    const supabase = createServiceClient();

    // Cover : remplacée si nouveau fichier fourni
    const newCover = form.get('cover') as File | null;
    let coverUrl: string | undefined;
    if (newCover && newCover.size > 0) {
      coverUrl = await uploadImage(
        supabase,
        slug,
        `cover-${Date.now().toString(36)}`,
        newCover,
      );
    }

    // Slides : on garde la liste existante (URLs conservées) + on ajoute les nouvelles
    const existingSlides = JSON.parse(
      String(form.get('existingSlides') || '[]'),
    ) as string[];
    const newSlideFiles = form
      .getAll('newSlides')
      .filter((f): f is File => f instanceof File && f.size > 0);

    const newSlideUrls: string[] = [];
    for (let i = 0; i < newSlideFiles.length; i++) {
      newSlideUrls.push(
        await uploadImage(
          supabase,
          slug,
          `slide-${Date.now().toString(36)}-${i + 1}`,
          newSlideFiles[i],
        ),
      );
    }

    const finalSlides = [...existingSlides, ...newSlideUrls];

    // Photos de prépa : même pattern (existantes + nouvelles)
    const existingPrepPhotos = JSON.parse(
      String(form.get('existingPrepPhotos') || '[]'),
    ) as string[];
    const newPrepPhotos = form
      .getAll('newPrepPhotos')
      .filter((f): f is File => f instanceof File && f.size > 0);
    const newPrepUrls: string[] = [];
    for (let i = 0; i < newPrepPhotos.length; i++) {
      newPrepUrls.push(
        await uploadImage(
          supabase,
          slug,
          `prep-${Date.now().toString(36)}-${i + 1}`,
          newPrepPhotos[i],
        ),
      );
    }
    const finalPrepPhotos = [...existingPrepPhotos, ...newPrepUrls];

    // Récupère l'état actuel pour gérer published_at
    const { data: current } = await supabase
      .from('recipes')
      .select('status, published_at')
      .eq('slug', slug)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 });

    type RecipeUpdate = {
      title: string;
      category: string;
      tags: string[];
      aliments: string[];
      calories: number | null;
      is_seasonal: boolean;
      is_featured: boolean;
      status: string;
      slides: string[];
      prep_photos: string[];
      prep_time_min: number | null;
      cook_time_min: number | null;
      cover_image_url?: string;
      published_at?: string | null;
    };

    const update: RecipeUpdate = {
      title,
      category,
      tags,
      aliments,
      calories: caloriesRaw ? Number(caloriesRaw) : null,
      is_seasonal: isSeasonal,
      is_featured: isFeatured,
      status,
      slides: finalSlides,
      prep_photos: finalPrepPhotos,
      prep_time_min: prepTimeRaw ? Number(prepTimeRaw) : null,
      cook_time_min: cookTimeRaw ? Number(cookTimeRaw) : null,
    };
    if (coverUrl) update.cover_image_url = coverUrl;
    if (status === 'published' && current.status !== 'published') {
      update.published_at = new Date().toISOString();
    } else if (status !== 'published' && current.status === 'published') {
      update.published_at = null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('recipes').update(update as any).eq('slug', slug);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug } = await ctx.params;
    const supabase = createServiceClient();

    // Best-effort : supprime les fichiers du dossier Storage recipes/{slug}/
    const { data: files } = await supabase.storage.from(BUCKET).list(`recipes/${slug}`);
    if (files && files.length > 0) {
      const paths = files.map((f) => `recipes/${slug}/${f.name}`);
      await supabase.storage.from(BUCKET).remove(paths);
    }

    const { error } = await supabase.from('recipes').delete().eq('slug', slug);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
