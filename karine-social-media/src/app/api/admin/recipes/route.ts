import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { extractIngredientsFromText } from '@/lib/claude-recipe-ingredients';

// L'extraction Claude peut prendre 2-5s. On laisse 60s par sécurité.
export const maxDuration = 60;

// Note : la colonne `is_seasonal` (migration 20260530180000_recipes_is_seasonal.sql)
// n'est pas encore dans les types Supabase générés (`src/types/database.ts`).
// Tant que `supabase gen types` n'a pas regénéré le fichier, on cast l'objet pour
// que TS n'éjecte pas la propriété (RejectExcessProperties).

const BUCKET = 'content-images';

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
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

/**
 * Sanitise une extension : ne garde que [a-z0-9], max 5 caractères.
 * Supabase Storage refuse les paths avec caractères unicode / espaces.
 */
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
  // Conversion WebP (qualité 85) systématique avant upload Storage
  const { buffer, ext, contentType } = await optimizeUploadToWebp(file);
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const path = `recipes/${slug}/${safeName}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: true, contentType });
  if (error) {
    console.error('[uploadImage] Storage error for file:', {
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

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
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
    const servingsRaw = String(form.get('servings') || '').trim();
    const ingredientsText = String(form.get('ingredientsText') || '').trim();
    const cover = form.get('cover') as File | null;
    // Plus de slides/prepPhotos ici → uploadés en PUT incrémental après création
    // pour éviter le 413 (Vercel limite chaque requête à ~4,5 MB).

    if (!title) return NextResponse.json({ error: 'Titre requis' }, { status: 400 });
    if (!['petit_dejeuner', 'entree', 'salade', 'plat', 'sauce', 'gouter', 'dessert', 'boisson', 'aperitif', 'repas_fete'].includes(category))
      return NextResponse.json({ error: 'Catégorie invalide' }, { status: 400 });
    if (!cover || cover.size === 0)
      return NextResponse.json({ error: 'Image principale requise' }, { status: 400 });

    const supabase = createServiceClient();

    // slug unique
    let slug = slugify(title) || `recette-${Date.now().toString(36)}`;
    const { data: existing } = await supabase.from('recipes').select('slug').eq('slug', slug).maybeSingle();
    if (existing) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const coverUrl = await uploadImage(supabase, slug, 'cover', cover);

    // Extraction Claude des ingrédients structurés.
    // On la fait UNE FOIS au create. Si extraction échoue (réseau, modèle),
    // on log mais on ne bloque pas la création — Karine pourra réessayer
    // en éditant.
    let ingredients: unknown[] = [];
    if (ingredientsText) {
      try {
        ingredients = await extractIngredientsFromText(ingredientsText);
      } catch (extractErr) {
        console.warn(
          '[admin/recipes POST] extraction ingredients failed (non-blocking):',
          extractErr,
        );
      }
    }

    const insertPayload = {
      slug,
      title,
      category,
      cover_image_url: coverUrl,
      slides: [],
      tags,
      aliments,
      calories: caloriesRaw ? Number(caloriesRaw) : null,
      is_seasonal: isSeasonal,
      is_featured: isFeatured,
      prep_photos: [],
      prep_time_min: prepTimeRaw ? Number(prepTimeRaw) : null,
      cook_time_min: cookTimeRaw ? Number(cookTimeRaw) : null,
      servings: servingsRaw ? Math.max(1, Math.min(20, Number(servingsRaw))) : 4,
      ingredients_text: ingredientsText || null,
      ingredients,
      status,
      published_at: status === 'published' ? new Date().toISOString() : null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('recipes').insert(insertPayload as any);
    if (error) throw error;

    return NextResponse.json({ ok: true, slug });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
