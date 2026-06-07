import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import type { RecipeIngredient } from '@/data/recipes';

const BUCKET = 'content-images';
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

const CATEGORIES = new Set([
  'petit_dejeuner',
  'entree',
  'salade',
  'plat',
  'sauce',
  'gouter',
  'dessert',
  'boisson',
  'aperitif',
  'repas_fete',
  'sur_le_pouce',
  'repas_famille',
]);

type SheetPayload = {
  tempPath?: string;
  title?: string | null;
  servings?: number | null;
  calories?: number | null;
  prepTimeMin?: number | null;
  cookTimeMin?: number | null;
  tags?: string[];
  aliments?: string[];
  ingredients?: RecipeIngredient[];
};

/**
 * POST /api/admin/recipes
 *
 * Création unifiée d'une recette en UN SEUL appel. Le client a déjà :
 *   1. Appelé /preview-main pour uploader la cover en temp + extraire
 *   2. Appelé /sheets-preview-bulk pour les fiches détaillées
 *   3. Laissé Karine corriger les données extraites
 *
 * Maintenant on assemble tout :
 *   - Move la cover temp → recipes/{slug}/cover.webp
 *   - Crée la row recipes (titre, category, cover, status, etc.)
 *   - Pour chaque sheet : move temp + insert recipe_sheets
 *   - Si aucune sheet uploadée MAIS la cover a été lue comme fiche
 *     complète (mainAsSheet fourni) → crée sheet 0 avec cover URL
 *
 * Body JSON :
 * {
 *   title?: string,             // titre final, sinon = mainExtractedTitle
 *   category: RecipeCategory,
 *   status: 'draft' | 'published',
 *   isSeasonal: boolean,
 *   isFeatured: boolean,
 *   mainTempPath: string,       // chemin temp de la cover
 *   mainAsSheet?: SheetPayload, // si la cover est elle-même une fiche
 *   sheets: SheetPayload[]      // fiches détaillées (optional, can be empty)
 * }
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const category = typeof body.category === 'string' ? body.category : '';
    const status = body.status === 'published' ? 'published' : 'draft';
    const isSeasonal = body.isSeasonal === true;
    const isFeatured = body.isFeatured === true;
    const isPublic = body.isPublic === true;
    const mainTempPath =
      typeof body.mainTempPath === 'string' ? body.mainTempPath.trim() : '';
    const mainAsSheet =
      body.mainAsSheet && typeof body.mainAsSheet === 'object'
        ? (body.mainAsSheet as SheetPayload)
        : null;
    const sheetsRaw: SheetPayload[] = Array.isArray(body.sheets) ? body.sheets : [];

    if (!CATEGORIES.has(category)) {
      return NextResponse.json({ error: 'Catégorie invalide.' }, { status: 400 });
    }
    if (!mainTempPath || !mainTempPath.startsWith('temp-recipe-main/')) {
      return NextResponse.json(
        { error: 'mainTempPath invalide.' },
        { status: 400 },
      );
    }
    if (!title) {
      return NextResponse.json({ error: 'Titre requis.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // 1. Génère slug unique
    let slug = slugify(title) || `recette-${Date.now().toString(36)}`;
    const { data: exists } = await supabase
      .from('recipes')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();
    if (exists) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    // 2. Move la cover principale temp → final
    const coverFinal = `recipes/${slug}/cover.webp`;
    const { error: mvErr } = await supabase.storage
      .from(BUCKET)
      .move(mainTempPath, coverFinal);
    if (mvErr) throw mvErr;
    const coverUrl = supabase.storage.from(BUCKET).getPublicUrl(coverFinal).data
      .publicUrl;

    // 3. Insert recipe (sans valeurs de fiche détaillée — elles vivent sur recipe_sheets)
    const insertPayload = {
      slug,
      title,
      category,
      cover_image_url: coverUrl,
      slides: [],
      tags: [],
      aliments: [],
      is_seasonal: isSeasonal,
      is_featured: isFeatured,
      is_public: isPublic,
      prep_photos: [],
      status,
      published_at: status === 'published' ? new Date().toISOString() : null,
    };
    const { data: recipeRow, error: insErr } = await supabase
      .from('recipes')
      .insert(insertPayload as any)
      .select('id, slug')
      .single();
    if (insErr) throw insErr;
    const recipeId = Number((recipeRow as { id: number | string }).id);

    // 4. Crée les sheets
    //   - Si des sheets sont uploadées : on les utilise (move temp → final)
    //   - Sinon, si mainAsSheet a des ingrédients : crée sheet 0 à partir
    //     de la cover (la cover EST la fiche)
    let sheetsToInsert: Array<{
      payload: SheetPayload;
      coverUrl: string;
    }> = [];

    if (sheetsRaw.length > 0) {
      // Move chaque sheet temp → final
      for (let i = 0; i < sheetsRaw.length; i++) {
        const s = sheetsRaw[i];
        const tempPath = typeof s.tempPath === 'string' ? s.tempPath.trim() : '';
        if (!tempPath || !tempPath.startsWith('temp-recipe-sheets/')) {
          console.warn(`[recipes POST] sheet ${i} skipped : tempPath invalide`);
          continue;
        }
        const finalPath = `recipes/${slug}/sheet-${i}-${Date.now()
          .toString(36)
          .slice(-4)}.webp`;
        const { error: mvShErr } = await supabase.storage
          .from(BUCKET)
          .move(tempPath, finalPath);
        if (mvShErr) {
          console.warn(`[recipes POST] move sheet ${i} failed:`, mvShErr);
          continue;
        }
        const sheetUrl = supabase.storage.from(BUCKET).getPublicUrl(finalPath).data
          .publicUrl;
        sheetsToInsert.push({ payload: s, coverUrl: sheetUrl });
      }
    } else if (mainAsSheet && Array.isArray(mainAsSheet.ingredients) && mainAsSheet.ingredients.length > 0) {
      // La cover EST elle-même une fiche détaillée : on crée sheet 0
      sheetsToInsert.push({ payload: mainAsSheet, coverUrl });
    }

    // Insert chaque sheet
    for (let i = 0; i < sheetsToInsert.length; i++) {
      const { payload, coverUrl: shCover } = sheetsToInsert[i];
      const sheetPayload = {
        recipe_id: recipeId,
        sheet_index: i,
        title:
          typeof payload.title === 'string' ? payload.title.trim() || null : null,
        cover_image_url: shCover,
        servings: clampInt(payload.servings, 4, 1, 20),
        calories: nullableInt(payload.calories),
        prep_time_min: nullableInt(payload.prepTimeMin),
        cook_time_min: nullableInt(payload.cookTimeMin),
        tags: stringArray(payload.tags),
        aliments: stringArray(payload.aliments),
        ingredients: sanitizeIngredients(payload.ingredients),
      };
      const { error: shErr } = await (supabase as any)
        .from('recipe_sheets')
        .insert(sheetPayload);
      if (shErr) {
        console.warn(`[recipes POST] insert sheet ${i} failed:`, shErr);
      }
    }

    return NextResponse.json({
      ok: true,
      slug,
      sheetsCreated: sheetsToInsert.length,
    });
  } catch (e) {
    console.error('[admin/recipes POST] error:', e);
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ============================================================
// Helpers
// ============================================================

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function nullableInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
}

function sanitizeIngredients(v: unknown): RecipeIngredient[] {
  if (!Array.isArray(v)) return [];
  const out: RecipeIngredient[] = [];
  for (const it of v) {
    if (!it || typeof it !== 'object') continue;
    const obj = it as Record<string, unknown>;
    const category = typeof obj.category === 'string' ? obj.category.trim() : '';
    const label = typeof obj.label === 'string' ? obj.label.trim() : '';
    if (!category || !label) continue;
    out.push({
      category,
      label,
      quantity: typeof obj.quantity === 'number' ? obj.quantity : null,
      unit: typeof obj.unit === 'string' ? obj.unit.trim() || null : null,
      note: typeof obj.note === 'string' ? obj.note.trim() || null : null,
    });
  }
  return out;
}
