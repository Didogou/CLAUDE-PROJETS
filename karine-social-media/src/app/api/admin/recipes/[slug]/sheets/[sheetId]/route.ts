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

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PATCH /api/admin/recipes/[slug]/sheets/[sheetId]
 *
 * Met à jour une fiche détaillée. Body JSON partiel : { title?,
 * servings?, calories?, prepTimeMin?, cookTimeMin?, tags?, aliments?,
 * ingredients?, ingredientsText? }. Champs non fournis = inchangés.
 *
 * Pour remplacer la cover de la sheet, utiliser /sheets/preview puis
 * fournir { tempPath } dans le body (move vers final path).
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string; sheetId: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug, sheetId } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const patch: Record<string, unknown> = {};

    if (typeof body.title === 'string') {
      patch.title = body.title.trim() || null;
    }
    if (body.servings !== undefined) {
      patch.servings = clampInt(body.servings, 4, 1, 20);
    }
    if (body.calories !== undefined) patch.calories = nullableInt(body.calories);
    if (body.prepTimeMin !== undefined)
      patch.prep_time_min = nullableInt(body.prepTimeMin);
    if (body.cookTimeMin !== undefined)
      patch.cook_time_min = nullableInt(body.cookTimeMin);
    if (body.tags !== undefined) patch.tags = stringArray(body.tags);
    if (body.aliments !== undefined) patch.aliments = stringArray(body.aliments);
    if (body.ingredients !== undefined)
      patch.ingredients = sanitizeIngredients(body.ingredients);
    if (typeof body.ingredientsText === 'string') {
      patch.ingredients_text = body.ingredientsText.trim() || null;
    }
    // Overrides admin tags diététiques (Auto = null, true/false = forcé).
    if (body.isVegetarianOverride !== undefined) {
      patch.is_vegetarian_override =
        body.isVegetarianOverride === null
          ? null
          : Boolean(body.isVegetarianOverride);
    }
    if (body.isGlutenFreeOverride !== undefined) {
      patch.is_gluten_free_override =
        body.isGlutenFreeOverride === null
          ? null
          : Boolean(body.isGlutenFreeOverride);
    }
    if (body.isPorkFreeOverride !== undefined) {
      patch.is_pork_free_override =
        body.isPorkFreeOverride === null
          ? null
          : Boolean(body.isPorkFreeOverride);
    }

    // Remplacement de l'image via tempPath
    const tempPath =
      typeof body.tempPath === 'string' ? body.tempPath.trim() : '';
    if (tempPath && tempPath.startsWith('temp-recipe-sheets/')) {
      const finalPath = `recipes/${slug}/sheet-${Date.now().toString(36)}.webp`;
      const { error: mvErr } = await supabase.storage
        .from(BUCKET)
        .move(tempPath, finalPath);
      if (!mvErr) {
        patch.cover_image_url = supabase.storage
          .from(BUCKET)
          .getPublicUrl(finalPath).data.publicUrl;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Rien à mettre à jour.' }, { status: 400 });
    }

    // Si les ingrédients ou les portions ont été modifiés, recalcul
    // automatique des macros par portion. Tolérant (non bloquant).
    if (
      patch.ingredients !== undefined ||
      patch.servings !== undefined
    ) {
      try {
        // Récupère l'état "sera" (patch ∪ existant) pour calcul cohérent
        // même si le caller n'envoie que les ingredients sans servings.
        const { data: current } = await (supabase as any)
          .from('recipe_sheets')
          .select('ingredients, servings')
          .eq('id', sheetId)
          .maybeSingle();
        const ingredients =
          (patch.ingredients as RecipeIngredient[] | undefined) ??
          (current?.ingredients as RecipeIngredient[] | null) ??
          [];
        const servings =
          (patch.servings as number | undefined) ??
          Number(current?.servings) ??
          4;
        const ciqualById = await fetchCiqualForIngredients(
          supabase,
          ingredients,
        );
        const computed = computeSheetMacros(ingredients, servings, ciqualById);
        patch.proteins_g = computed.proteinsG;
        patch.lipids_g = computed.lipidsG;
        patch.carbs_g = computed.carbsG;
      } catch (e) {
        console.warn('[sheets PATCH] macros compute failed (non-fatal):', e);
      }
    }

    const { data, error } = await (supabase as any)
      .from('recipe_sheets')
      .update(patch)
      .eq('id', sheetId)
      .select()
      .single();
    if (error) throw error;

    // Si on a touché aux ingrédients, on recalcule le Nutri-Score et
    // on persiste les colonnes nutriscore_*. Tolérant aux erreurs : si
    // ça échoue, le save de la sheet a déjà réussi en amont.
    if (patch.ingredients !== undefined) {
      await persistNutriscoreForSheet(sheetId);
    }

    return NextResponse.json({ ok: true, sheet: data });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE — supprime une fiche détaillée. */
export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string; sheetId: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { sheetId } = await ctx.params;
    const supabase = createServiceClient();
    // Récupère la cover URL pour cleanup Storage best-effort
    const { data: existing } = await (supabase as any)
      .from('recipe_sheets')
      .select('cover_image_url')
      .eq('id', sheetId)
      .maybeSingle();
    const oldUrl = existing?.cover_image_url as string | undefined;

    const { error } = await (supabase as any)
      .from('recipe_sheets')
      .delete()
      .eq('id', sheetId);
    if (error) throw error;

    // Best-effort : retire le fichier Storage si on peut extraire le path
    if (oldUrl) {
      try {
        const u = new URL(oldUrl);
        const idx = u.pathname.indexOf(`/${BUCKET}/`);
        if (idx !== -1) {
          const path = u.pathname.slice(idx + BUCKET.length + 2);
          await supabase.storage.from(BUCKET).remove([path]);
        }
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ============================================================
// Helpers (dupliqués depuis la route parent pour rester
// indépendant — pas la peine d'extraire un fichier partagé pour
// 30 lignes).
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
      // Lien vers la table Ciqual posé par Karine via la page admin
      // Nutri-Score. Optionnel, persiste tel quel quand fourni.
      ciqual_food_id:
        typeof obj.ciqual_food_id === 'number' &&
        Number.isFinite(obj.ciqual_food_id)
          ? obj.ciqual_food_id
          : null,
    });
  }
  return out;
}
