/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/cleanup-orphans
 *
 * Purge rétroactive des références orphelines vers des recettes qui
 * n'existent plus. Utile pour nettoyer la DB après suppression de
 * recettes faites AVANT que le trigger trg_cascade_purge_recipe_refs
 * soit en place.
 *
 * Pour chaque source :
 *   1. favorites (target_type='recipe' + target_id pas dans recipes.slug)
 *   2. shopping_lists.linked_recipes (JSONB) où recipeSlug pas dans recipes.slug
 *   3. shopping_lists.linked_recipes (JSONB) où sheetId pas dans recipe_sheets.id
 *
 * Retourne le détail des purges effectuées.
 */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient() as any;
  const report = {
    favoritesPurged: 0,
    shoppingListsTouched: 0,
    recipeRefsRemoved: 0,
    sheetRefsRemoved: 0,
  };

  // ============================================================
  // 1. favorites — purge target_type='recipe' avec slug introuvable
  // ============================================================
  const { data: orphanFavs, error: favSelectErr } = await supabase
    .from('favorites')
    .select('user_id, target_id')
    .eq('target_type', 'recipe');
  if (favSelectErr) {
    return NextResponse.json({ error: favSelectErr.message }, { status: 500 });
  }

  if (Array.isArray(orphanFavs) && orphanFavs.length > 0) {
    const slugs = [...new Set(orphanFavs.map((f: any) => f.target_id as string))];
    const { data: existingRecipes } = await supabase
      .from('recipes')
      .select('slug')
      .in('slug', slugs);
    const existingSlugs = new Set(
      (existingRecipes ?? []).map((r: any) => r.slug as string),
    );
    const toDelete = orphanFavs.filter(
      (f: any) => !existingSlugs.has(f.target_id),
    );
    if (toDelete.length > 0) {
      // Suppression par batch (group by target_id pour minimiser les requêtes)
      const orphanSlugs = [
        ...new Set(toDelete.map((f: any) => f.target_id as string)),
      ];
      const { error: delErr, count } = await supabase
        .from('favorites')
        .delete({ count: 'exact' })
        .eq('target_type', 'recipe')
        .in('target_id', orphanSlugs);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
      report.favoritesPurged = count ?? 0;
    }
  }

  // ============================================================
  // 2 + 3. shopping_lists.linked_recipes — filter le JSONB
  // ============================================================
  const { data: lists, error: listsErr } = await supabase
    .from('shopping_lists')
    .select('id, linked_recipes')
    .neq('linked_recipes', '[]');
  if (listsErr) {
    return NextResponse.json({ error: listsErr.message }, { status: 500 });
  }

  if (Array.isArray(lists) && lists.length > 0) {
    // Collecte tous les slugs et sheet_ids référencés
    const allSlugs = new Set<string>();
    const allSheetIds = new Set<string>();
    for (const l of lists) {
      const arr = Array.isArray(l.linked_recipes) ? l.linked_recipes : [];
      for (const r of arr as Array<{ recipeSlug?: string; sheetId?: string }>) {
        if (r.recipeSlug) allSlugs.add(r.recipeSlug);
        if (r.sheetId) allSheetIds.add(r.sheetId);
      }
    }

    // Récupère les slugs et sheet_ids EXISTANTS
    const [{ data: recipesData }, { data: sheetsData }] = await Promise.all([
      allSlugs.size > 0
        ? supabase.from('recipes').select('slug').in('slug', [...allSlugs])
        : Promise.resolve({ data: [] }),
      allSheetIds.size > 0
        ? supabase.from('recipe_sheets').select('id').in('id', [...allSheetIds])
        : Promise.resolve({ data: [] }),
    ]);
    const existingSlugs = new Set(
      (recipesData ?? []).map((r: any) => r.slug as string),
    );
    const existingSheetIds = new Set(
      (sheetsData ?? []).map((r: any) => r.id as string),
    );

    // Filtre chaque liste et update si modifié
    for (const l of lists) {
      const arr = Array.isArray(l.linked_recipes)
        ? (l.linked_recipes as Array<{ recipeSlug?: string; sheetId?: string }>)
        : [];
      const filtered = arr.filter(
        (r) =>
          (!r.recipeSlug || existingSlugs.has(r.recipeSlug)) &&
          (!r.sheetId || existingSheetIds.has(r.sheetId)),
      );
      const removed = arr.length - filtered.length;
      if (removed > 0) {
        // Compte combien sont retirés à cause d'un slug manquant vs sheet manquant
        for (const r of arr) {
          if (r.recipeSlug && !existingSlugs.has(r.recipeSlug))
            report.recipeRefsRemoved++;
          else if (r.sheetId && !existingSheetIds.has(r.sheetId))
            report.sheetRefsRemoved++;
        }
        const { error: updErr } = await supabase
          .from('shopping_lists')
          .update({ linked_recipes: filtered })
          .eq('id', l.id);
        if (updErr) {
          return NextResponse.json(
            { error: updErr.message },
            { status: 500 },
          );
        }
        report.shoppingListsTouched++;
      }
    }
  }

  return NextResponse.json({ ok: true, report });
}
