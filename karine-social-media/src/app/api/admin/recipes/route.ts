import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';
import { extractRecipeSheetFromImage } from '@/lib/claude-recipe-vision';

// L'extraction Vision peut prendre 5-15s. On laisse 60s par sécurité.
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

/**
 * POST /api/admin/recipes
 *
 * Création simplifiée d'une recette (nouveau modèle) :
 *  - Karine choisit la catégorie + status + upload la cover principale
 *  - Vision Haiku 4.5 lit la cover et extrait TOUT (titre + calories +
 *    temps + servings + tags + aliments + ingrédients)
 *  - Si l'extraction contient au moins 1 ingrédient → on crée recipe
 *    + 1 sheet auto à partir des données extraites (cas "Karine ne
 *    charge pas de fiche détaillée → la cover est sa fiche")
 *  - Sinon → on crée juste la recipe avec le titre extrait, 0 sheet
 *    (cas couverture de groupe "6 Recettes de Poivrons Farcis")
 *
 * Karine ajoute ensuite manuellement les fiches détaillées via
 * /sheets/preview puis /sheets.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const form = await request.formData();
    const category = String(form.get('category') || '');
    const status = String(form.get('status') || 'draft');
    const isSeasonal = form.get('isSeasonal') === 'on' || form.get('isSeasonal') === 'true';
    const isFeatured = form.get('isFeatured') === 'on' || form.get('isFeatured') === 'true';
    const titleOverride = String(form.get('title') || '').trim();
    const cover = form.get('cover') as File | null;

    if (!['petit_dejeuner', 'entree', 'salade', 'plat', 'sauce', 'gouter', 'dessert', 'boisson', 'aperitif', 'repas_fete'].includes(category))
      return NextResponse.json({ error: 'Catégorie invalide' }, { status: 400 });
    if (!cover || cover.size === 0)
      return NextResponse.json({ error: 'Image principale requise' }, { status: 400 });

    const supabase = createServiceClient();

    // === 1. Optimisation + Vision sur la cover (avant Storage) ===
    const { buffer, contentType } = await optimizeUploadToWebp(cover);
    let extracted: Awaited<ReturnType<typeof extractRecipeSheetFromImage>> | null = null;
    try {
      extracted = await extractRecipeSheetFromImage(buffer, 'image/webp');
    } catch (visionErr) {
      console.warn('[admin/recipes POST] Vision extract failed (non-blocking):', visionErr);
    }

    const titleFromVision = extracted?.title?.trim() || '';
    const finalTitle = titleOverride || titleFromVision || 'Recette sans titre';

    // === 2. slug unique + upload Storage ===
    let slug = slugify(finalTitle) || `recette-${Date.now().toString(36)}`;
    const { data: existing } = await supabase
      .from('recipes')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();
    if (existing) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const coverPath = `recipes/${slug}/cover.webp`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(coverPath, buffer, { upsert: true, contentType });
    if (upErr) throw upErr;
    const coverUrl = supabase.storage.from(BUCKET).getPublicUrl(coverPath).data.publicUrl;

    // === 3. Insert recipe (sans les valeurs de fiche détaillée — elles
    //        vivent désormais sur recipe_sheets) ===
    const insertPayload = {
      slug,
      title: finalTitle,
      category,
      cover_image_url: coverUrl,
      slides: [],
      tags: [],
      aliments: [],
      is_seasonal: isSeasonal,
      is_featured: isFeatured,
      prep_photos: [],
      status,
      published_at: status === 'published' ? new Date().toISOString() : null,
    };
    const { data: inserted, error } = await supabase
      .from('recipes')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(insertPayload as any)
      .select('id, slug')
      .single();
    if (error) throw error;
    const recipeId = Number((inserted as { id: number | string }).id);

    // === 4. Si Vision a extrait des ingrédients → créer la sheet 0
    //        à partir de ces données (cas "la cover est elle-même
    //        une fiche détaillée complète") ===
    let createdSheet = false;
    if (extracted && extracted.ingredients.length > 0) {
      const sheetPayload = {
        recipe_id: recipeId,
        sheet_index: 0,
        title: extracted.title,
        cover_image_url: coverUrl,
        servings: extracted.servings ?? 4,
        calories: extracted.calories,
        prep_time_min: extracted.prepTimeMin,
        cook_time_min: extracted.cookTimeMin,
        tags: extracted.tags,
        aliments: extracted.aliments,
        ingredients: extracted.ingredients,
        ingredients_text: null,
      };
      const { error: shErr } = await (supabase as any)
        .from('recipe_sheets')
        .insert(sheetPayload);
      if (shErr) {
        console.warn('[admin/recipes POST] insert sheet 0 failed (non-blocking):', shErr);
      } else {
        createdSheet = true;
      }
    }

    return NextResponse.json({
      ok: true,
      slug,
      titleFromVision,
      createdAutoSheet: createdSheet,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
