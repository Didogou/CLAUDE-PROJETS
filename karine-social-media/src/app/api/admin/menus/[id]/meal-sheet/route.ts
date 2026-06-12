import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { persistNutriscoreForMenuMealSheet } from '@/lib/nutriscore-persist';
import type { ShoppingListItem } from '@/data/menus';

const BUCKET = 'content-images';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/admin/menus/[id]/meal-sheet
 *
 * Persiste une fiche repas validée par Karine (upsert sur le slot
 * unique (menu_id, day_index, meal_kind)).
 *
 * Body JSON :
 * {
 *   dayIndex: 0..6,
 *   mealKind: 'lunch' | 'dinner',
 *   tempPath: string,  // chemin temp dans Storage (issu du /preview)
 *   title: string | null,
 *   servings: number,
 *   calories: number | null,
 *   prepTimeMin: number | null,
 *   cookTimeMin: number | null,
 *   tags: string[],
 *   aliments: string[],
 *   ingredients: ShoppingListItem[]
 * }
 *
 * Comportement :
 *   1. Déplace l'image temp vers menus/{menuId}/meal-{day}-{kind}-{ts}.webp
 *   2. Upsert dans menu_meal_sheets selon (menu_id, day_index, meal_kind)
 *   3. Retourne la sheet créée/mise à jour
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id: menuId } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
    }

    const dayIndex = clampInt(body.dayIndex, -1, 0, 6);
    const mealKind = body.mealKind === 'dinner' ? 'dinner' : body.mealKind === 'lunch' ? 'lunch' : null;
    const tempPath = typeof body.tempPath === 'string' ? body.tempPath.trim() : '';

    if (dayIndex < 0) {
      return NextResponse.json({ error: 'dayIndex invalide (0-6).' }, { status: 400 });
    }
    if (mealKind === null) {
      return NextResponse.json({ error: 'mealKind invalide (lunch|dinner).' }, { status: 400 });
    }
    if (!tempPath || !tempPath.startsWith('temp-menu-meal/')) {
      return NextResponse.json({ error: 'tempPath invalide.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // 1. Move temp → final
    const finalPath = `menus/${menuId}/meal-${dayIndex}-${mealKind}-${Date.now()
      .toString(36)
      .slice(-6)}.webp`;
    const { error: mvErr } = await supabase.storage
      .from(BUCKET)
      .move(tempPath, finalPath);
    if (mvErr) throw mvErr;
    const coverImageUrl = supabase.storage.from(BUCKET).getPublicUrl(finalPath).data.publicUrl;

    // 2. Upsert : delete existant pour ce slot puis insert (plus simple que
    //    onConflict avec jsonb).
    await (supabase as any)
      .from('menu_meal_sheets')
      .delete()
      .eq('menu_id', menuId)
      .eq('day_index', dayIndex)
      .eq('meal_kind', mealKind);

    const sanitizedIngredients = sanitizeIngredients(body.ingredients);

    const insertPayload = {
      menu_id: menuId,
      day_index: dayIndex,
      meal_kind: mealKind,
      title: typeof body.title === 'string' ? body.title.trim() || null : null,
      cover_image_url: coverImageUrl,
      servings: clampInt(body.servings, 4, 1, 20),
      calories: nullableInt(body.calories),
      proteins_g: nullableNum(body.proteinsG),
      lipids_g: nullableNum(body.lipidsG),
      carbs_g: nullableNum(body.carbsG),
      prep_time_min: nullableInt(body.prepTimeMin),
      cook_time_min: nullableInt(body.cookTimeMin),
      tags: stringArray(body.tags),
      aliments: stringArray(body.aliments),
      ingredients: sanitizedIngredients,
    };
    const { data, error } = await (supabase as any)
      .from('menu_meal_sheets')
      .insert(insertPayload)
      .select()
      .single();
    if (error) throw error;

    // Recalcul + persistance du Nutri-Score sur la sheet nouvellement
    // créée. Tolérant aux erreurs : si la migration n'est pas appliquée
    // ou si le calcul échoue, le POST reste OK (mais sans grade).
    if (data?.id) {
      await persistNutriscoreForMenuMealSheet(data.id as string);
    }

    return NextResponse.json({ ok: true, sheet: data });
  } catch (e) {
    console.error('[admin/menus meal-sheet POST] error:', e);
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/menus/[id]/meal-sheet
 *
 * Supprime la fiche repas du slot (menu_id, day_index, meal_kind).
 * Body JSON : { dayIndex, mealKind }
 */
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id: menuId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const dayIndex = clampInt(body.dayIndex, -1, 0, 6);
    const mealKind = body.mealKind === 'dinner' ? 'dinner' : body.mealKind === 'lunch' ? 'lunch' : null;
    if (dayIndex < 0 || mealKind === null) {
      return NextResponse.json({ error: 'dayIndex/mealKind requis.' }, { status: 400 });
    }
    const supabase = createServiceClient();
    const { data: existing } = await (supabase as any)
      .from('menu_meal_sheets')
      .select('cover_image_url')
      .eq('menu_id', menuId)
      .eq('day_index', dayIndex)
      .eq('meal_kind', mealKind)
      .maybeSingle();
    const oldUrl = existing?.cover_image_url as string | undefined;

    const { error } = await (supabase as any)
      .from('menu_meal_sheets')
      .delete()
      .eq('menu_id', menuId)
      .eq('day_index', dayIndex)
      .eq('meal_kind', mealKind);
    if (error) throw error;

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

function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Regex de placeholders bidons que Vision peut renvoyer quand elle
 * ne lit pas un label (au lieu d'omettre la ligne comme demandé) :
 * "—", "-", "?", "...", "…", "n/a", "—…", "ingrédient illisible".
 */
const PLACEHOLDER_LABEL =
  /^(?:[?\-—.…\s]+|n\/?a|illisible|ingr[ée]dient(?:\s+illisible)?|inconnu)$/i;

function sanitizeIngredients(v: unknown): ShoppingListItem[] {
  if (!Array.isArray(v)) return [];
  const out: ShoppingListItem[] = [];
  for (const it of v) {
    if (!it || typeof it !== 'object') continue;
    const obj = it as Record<string, unknown>;
    const category = typeof obj.category === 'string' ? obj.category.trim() : '';
    const label = typeof obj.label === 'string' ? obj.label.trim() : '';
    // Filtre : category + label requis, label non-placeholder
    if (!category || !label) continue;
    if (PLACEHOLDER_LABEL.test(label)) continue;
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
