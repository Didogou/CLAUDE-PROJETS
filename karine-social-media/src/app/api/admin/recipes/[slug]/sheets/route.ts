import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { persistNutriscoreForSheet } from '@/lib/nutriscore-persist';
import {
  computeSheetMacros,
  fetchCiqualForIngredients,
} from '@/lib/recipe-macros';
import type { RecipeIngredient } from '@/data/recipes';

const BUCKET = 'content-images';
// Création d'une sheet + résolution Mistral peut prendre du temps.
export const maxDuration = 60;

/**
 * POST /api/admin/recipes/[slug]/sheets — crée une fiche détaillée
 * Body JSON : { tempPath?, title?, servings, calories?, prepTimeMin?,
 *               cookTimeMin?, tags[], aliments[], ingredients[],
 *               ingredientsText? }
 *
 * Si `tempPath` fourni (issu de /preview), on déplace le fichier vers
 * recipes/{slug}/sheet-{ts}.webp. Sinon il faut que `coverImageUrl`
 * soit fourni directement.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
    }
    const supabase = createServiceClient();

    // Récupère recipe_id depuis le slug
    const { data: recipe } = await supabase
      .from('recipes')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (!recipe) {
      return NextResponse.json({ error: 'Recette introuvable.' }, { status: 404 });
    }
    const recipeId = Number((recipe as { id: number | string }).id);

    // Déplace l'image temp si fournie
    const tempPath = typeof body.tempPath === 'string' ? body.tempPath.trim() : '';
    let coverImageUrl: string | null =
      typeof body.coverImageUrl === 'string' ? body.coverImageUrl.trim() : null;

    if (tempPath && tempPath.startsWith('temp-recipe-sheets/')) {
      const finalPath = `recipes/${slug}/sheet-${Date.now().toString(36)}.webp`;
      const { error: mvErr } = await supabase.storage
        .from(BUCKET)
        .move(tempPath, finalPath);
      if (mvErr) {
        console.warn('[admin/sheets POST] move temp failed:', mvErr);
        // Erreur explicite côté client : le fichier temp n'existe plus
        // (TTL Supabase, double-submit, session client perdue, etc.).
        // Le user doit re-uploader la fiche depuis le bulk preview.
        const msg = /not found|no object/i.test(mvErr.message ?? '')
          ? "Le fichier temporaire a expiré (uploade plus ancien que l'attente Supabase). Re-uploade cette fiche depuis le batch preview."
          : `Déplacement du fichier impossible : ${mvErr.message ?? 'erreur inconnue'}`;
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      coverImageUrl = supabase.storage.from(BUCKET).getPublicUrl(finalPath).data
        .publicUrl;
    }

    if (!coverImageUrl) {
      return NextResponse.json(
        { error: 'Image de la fiche requise (tempPath ou coverImageUrl).' },
        { status: 400 },
      );
    }

    // Calcule le prochain sheet_index pour cette recette
    const { data: lastSheet } = await (supabase as any)
      .from('recipe_sheets')
      .select('sheet_index')
      .eq('recipe_id', recipeId)
      .order('sheet_index', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextIndex =
      typeof lastSheet?.sheet_index === 'number' ? lastSheet.sheet_index + 1 : 0;

    const sanitizedIngredients = sanitizeIngredients(body.ingredients);
    const servings = clampInt(body.servings, 4, 1, 20);

    // Calcul macros par portion depuis ingredients × Ciqual.
    // Tolérant : si erreur ou couverture < 30%, retourne null partout.
    let macrosProteins: number | null = null;
    let macrosLipids: number | null = null;
    let macrosCarbs: number | null = null;
    try {
      const ciqualById = await fetchCiqualForIngredients(
        supabase,
        sanitizedIngredients as unknown as RecipeIngredient[],
      );
      const computed = computeSheetMacros(
        sanitizedIngredients as unknown as RecipeIngredient[],
        servings,
        ciqualById,
      );
      macrosProteins = computed.proteinsG;
      macrosLipids = computed.lipidsG;
      macrosCarbs = computed.carbsG;
    } catch (e) {
      console.warn('[sheets POST] macros compute failed (non-fatal):', e);
    }

    const insertPayload = {
      recipe_id: recipeId,
      sheet_index: nextIndex,
      title: typeof body.title === 'string' ? body.title.trim() || null : null,
      cover_image_url: coverImageUrl,
      servings,
      calories: nullableInt(body.calories),
      prep_time_min: nullableInt(body.prepTimeMin),
      cook_time_min: nullableInt(body.cookTimeMin),
      tags: stringArray(body.tags),
      aliments: stringArray(body.aliments),
      ingredients: sanitizedIngredients,
      ingredients_text:
        typeof body.ingredientsText === 'string'
          ? body.ingredientsText.trim() || null
          : null,
      proteins_g: macrosProteins,
      lipids_g: macrosLipids,
      carbs_g: macrosCarbs,
    };

    const { data: sheetData, error } = await (supabase as any)
      .from('recipe_sheets')
      .insert(insertPayload)
      .select()
      .single();
    if (error) throw error;

    // Calcul + persist Nutri-Score (auto-link Ciqual + Mistral pour
    // poids unitaires manquants). Tolérant aux erreurs : si Mistral
    // tombe ou si la migration n'est pas appliquée, on log et on
    // retourne quand même OK — Karine peut compléter via l'éditeur.
    if (sheetData?.id) {
      try {
        await persistNutriscoreForSheet(sheetData.id as string);
      } catch (e) {
        console.warn('[admin/recipes sheets POST] persistNutriscore failed:', e);
      }
    }

    return NextResponse.json({ ok: true, sheet: sheetData });
  } catch (e) {
    console.error('[admin/recipes sheets POST] error:', e);
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
