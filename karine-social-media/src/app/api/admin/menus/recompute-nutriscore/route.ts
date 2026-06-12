import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { persistNutriscoreForMenuMealSheet } from '@/lib/nutriscore-persist';

export const runtime = 'nodejs';
export const maxDuration = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/admin/menus/recompute-nutriscore
 *
 * Recalcule + persiste le Nutri-Score sur les menu_meal_sheets
 * (= les fiches repas dans les menus de la semaine). Même logique que
 * /api/admin/recipes/recompute-nutriscore mais ciblé sur l'autre table.
 *
 * ⚠️ PRODUCTION-SAFE :
 *   - dryRun=true par défaut → calcule mais n'écrit RIEN, retourne le diff
 *   - limit max 50 par appel
 *   - cible optionnelle : sheetId pour 1 fiche précise OU menuId pour
 *     toutes les fiches d'un menu
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dryRun !== false;
  const rawLimit = typeof body.limit === 'number' ? body.limit : 10;
  const limit = Math.min(Math.max(1, Math.floor(rawLimit)), 50);
  const offset =
    typeof body.offset === 'number' ? Math.max(0, Math.floor(body.offset)) : 0;
  const targetSheetId =
    typeof body.sheetId === 'string' ? body.sheetId.trim() : '';
  const targetMenuId =
    typeof body.menuId === 'string' ? body.menuId.trim() : '';

  const supabase = createServiceClient() as any;

  // 1) Sélection des sheets cibles
  let sheetIds: string[] = [];
  if (targetSheetId) {
    sheetIds = [targetSheetId];
  } else if (targetMenuId) {
    const { data: ss } = await supabase
      .from('menu_meal_sheets')
      .select('id')
      .eq('menu_id', targetMenuId);
    sheetIds = (ss ?? []).map((s: any) => String(s.id));
  } else {
    const { data: ss, error } = await supabase
      .from('menu_meal_sheets')
      .select('id, nutriscore_computed_at')
      .order('nutriscore_computed_at', {
        ascending: true,
        nullsFirst: true,
      })
      .range(offset, offset + limit - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    sheetIds = ((ss ?? []) as Array<{ id: string }>).map((s) => s.id);
  }

  if (sheetIds.length === 0) {
    return NextResponse.json({
      dryRun,
      processed: 0,
      message: 'Aucune fiche-repas à traiter.',
    });
  }

  // 2) Snapshot AVANT
  const { data: before } = await supabase
    .from('menu_meal_sheets')
    .select(
      'id, nutriscore_grade, nutriscore_points, nutriscore_confidence, menu_id',
    )
    .in('id', sheetIds);
  const beforeById = new Map<string, any>();
  for (const b of (before ?? []) as any[]) beforeById.set(String(b.id), b);

  const results: Array<{
    sheetId: string;
    before: {
      grade: string | null;
      points: number | null;
      confidence: number | null;
    };
    after?: {
      grade: string | null;
      points: number | null;
      confidence: number | null;
    };
    changed?: boolean;
    error?: string;
  }> = [];

  for (const sId of sheetIds) {
    const bef = beforeById.get(sId);
    const beforeSnap = {
      grade: bef?.nutriscore_grade ?? null,
      points: bef?.nutriscore_points ?? null,
      confidence:
        bef?.nutriscore_confidence === null ||
        bef?.nutriscore_confidence === undefined
          ? null
          : Number(bef.nutriscore_confidence),
    };

    try {
      await persistNutriscoreForMenuMealSheet(sId);
      const { data: after } = await supabase
        .from('menu_meal_sheets')
        .select(
          'nutriscore_grade, nutriscore_points, nutriscore_confidence',
        )
        .eq('id', sId)
        .single();
      const afterSnap = {
        grade: after?.nutriscore_grade ?? null,
        points: after?.nutriscore_points ?? null,
        confidence:
          after?.nutriscore_confidence === null ||
          after?.nutriscore_confidence === undefined
            ? null
            : Number(after.nutriscore_confidence),
      };

      if (dryRun) {
        // ROLLBACK : restaure l'état AVANT
        await supabase
          .from('menu_meal_sheets')
          .update({
            nutriscore_grade: beforeSnap.grade,
            nutriscore_points: beforeSnap.points,
            nutriscore_confidence: beforeSnap.confidence,
          })
          .eq('id', sId);
      }

      const changed =
        afterSnap.grade !== beforeSnap.grade ||
        afterSnap.points !== beforeSnap.points ||
        Math.abs((afterSnap.confidence ?? 0) - (beforeSnap.confidence ?? 0)) >
          0.01;

      results.push({
        sheetId: sId,
        before: beforeSnap,
        after: afterSnap,
        changed,
      });
    } catch (e) {
      results.push({
        sheetId: sId,
        before: beforeSnap,
        error: e instanceof Error ? e.message : 'Erreur inconnue',
      });
    }
  }

  const changedCount = results.filter((r) => r.changed).length;
  const errorCount = results.filter((r) => r.error).length;

  return NextResponse.json({
    dryRun,
    processed: results.length,
    changedCount,
    errorCount,
    results,
    nextOffset: targetSheetId || targetMenuId ? null : offset + limit,
    hint: dryRun
      ? `Re-poste avec dryRun:false pour appliquer.`
      : `Re-poste avec offset:${offset + limit} pour continuer.`,
  });
}
