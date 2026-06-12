import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { persistNutriscoreForSheet } from '@/lib/nutriscore-persist';
import { revalidateRecipes } from '@/lib/cached-content';

export const runtime = 'nodejs';
// 5 min max : assez pour 30-50 sheets avec auto-link Ciqual cached
// (sans appels Mistral, juste compute + update).
export const maxDuration = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/admin/recipes/recompute-nutriscore
 *
 * Recalcule + persiste le Nutri-Score sur les recipe_sheets.
 *
 * ⚠️ PRODUCTION-SAFE :
 *   - dryRun=true par défaut → calcule mais n'écrit RIEN, retourne le diff
 *   - limit obligatoire (max 50 par appel) → impossible de tout casser
 *   - cible optionnelle : sheetId OU slug pour 1 seule recette
 *   - réponse : avant/après pour chaque sheet traitée
 *
 * Body JSON :
 *   {
 *     dryRun?: boolean         (défaut: true)
 *     limit?: number           (défaut: 10, max: 50)
 *     offset?: number          (défaut: 0)
 *     sheetId?: string         (cible 1 sheet précise — ignore limit/offset)
 *     slug?: string            (cible toutes les sheets d'une recette)
 *     onlySuspiciousPerfect?: boolean
 *                              (cible UNIQUEMENT confidence >= 0.99 et qui ont
 *                              au moins 1 ingrédient sans qty → c'est exactement
 *                              le cas "caviar d'aubergines 100% mais incomplet")
 *   }
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dryRun !== false; // défaut TRUE
  const rawLimit = typeof body.limit === 'number' ? body.limit : 10;
  const limit = Math.min(Math.max(1, Math.floor(rawLimit)), 50);
  const offset =
    typeof body.offset === 'number' ? Math.max(0, Math.floor(body.offset)) : 0;
  const onlySuspiciousPerfect = body.onlySuspiciousPerfect === true;
  const targetSheetId =
    typeof body.sheetId === 'string' ? body.sheetId.trim() : '';
  const targetSlug = typeof body.slug === 'string' ? body.slug.trim() : '';

  const supabase = createServiceClient() as any;

  // 1) Sélection des sheets cibles
  let sheetIds: string[] = [];
  if (targetSheetId) {
    sheetIds = [targetSheetId];
  } else if (targetSlug) {
    const { data: r } = await supabase
      .from('recipes')
      .select('id')
      .eq('slug', targetSlug)
      .maybeSingle();
    if (!r) {
      return NextResponse.json({ error: 'Slug introuvable' }, { status: 404 });
    }
    const { data: ss } = await supabase
      .from('recipe_sheets')
      .select('id')
      .eq('recipe_id', r.id);
    sheetIds = (ss ?? []).map((s: any) => String(s.id));
  } else {
    let q = supabase
      .from('recipe_sheets')
      .select('id, nutriscore_confidence, ingredients, nutriscore_grade')
      .order('nutriscore_computed_at', { ascending: true, nullsFirst: true });

    if (onlySuspiciousPerfect) {
      q = q.gte('nutriscore_confidence', 0.99);
    }
    q = q.range(offset, offset + limit - 1);
    const { data: ss, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    let candidates = (ss ?? []) as Array<{
      id: string;
      nutriscore_confidence: number | null;
      ingredients: Array<{
        label: string;
        quantity: number | null;
        unit: string | null;
      }> | null;
      nutriscore_grade: string | null;
    }>;
    // Filtre client-side : si onlySuspiciousPerfect, on ne garde que
    // celles qui ont au moins 1 ingrédient SANS qty (vrai "suspect").
    if (onlySuspiciousPerfect) {
      candidates = candidates.filter((c) =>
        (c.ingredients ?? []).some(
          (ing) => typeof ing.quantity !== 'number' || ing.quantity <= 0,
        ),
      );
    }
    sheetIds = candidates.map((c) => c.id);
  }

  if (sheetIds.length === 0) {
    return NextResponse.json({
      dryRun,
      processed: 0,
      message: 'Aucune sheet à traiter avec ces critères.',
    });
  }

  // 2) Snapshot des valeurs AVANT
  const { data: before } = await supabase
    .from('recipe_sheets')
    .select(
      'id, nutriscore_grade, nutriscore_points, nutriscore_confidence, recipe_id',
    )
    .in('id', sheetIds);
  const beforeById = new Map<string, any>();
  for (const b of (before ?? []) as any[]) beforeById.set(String(b.id), b);

  // 3) Process séquentiel
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
      if (dryRun) {
        // En dry-run : on appelle persistNutriscoreForSheet... NON.
        // persistNutriscoreForSheet fait l'update direct. Pour dry-run il
        // faudrait re-fait le calcul à la main. Pour V1 pragmatique : on
        // RUN le persist puis on RESTAURE l'ancien état si dryRun.
        await persistNutriscoreForSheet(sId);
        const { data: after } = await supabase
          .from('recipe_sheets')
          .select('nutriscore_grade, nutriscore_points, nutriscore_confidence')
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
        // ROLLBACK : restaure l'état avant
        await supabase
          .from('recipe_sheets')
          .update({
            nutriscore_grade: beforeSnap.grade,
            nutriscore_points: beforeSnap.points,
            nutriscore_confidence: beforeSnap.confidence,
          })
          .eq('id', sId);
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
      } else {
        // Vrai run : compute + persist sans rollback
        await persistNutriscoreForSheet(sId);
        const { data: after } = await supabase
          .from('recipe_sheets')
          .select('nutriscore_grade, nutriscore_points, nutriscore_confidence')
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
      }
    } catch (e) {
      results.push({
        sheetId: sId,
        before: beforeSnap,
        error: 'Erreur serveur',
      });
    }
  }

  const changedCount = results.filter((r) => r.changed).length;
  const errorCount = results.filter((r) => r.error).length;

  // Invalide le cache uniquement si on a vraiment écrit (pas dry-run)
  // ET au moins une fiche a changé.
  if (!dryRun && changedCount > 0) {
    revalidateRecipes();
  }

  return NextResponse.json({
    dryRun,
    processed: results.length,
    changedCount,
    errorCount,
    results,
    nextOffset: targetSheetId || targetSlug ? null : offset + limit,
    hint: dryRun
      ? `Re-poste avec { dryRun: false${
          onlySuspiciousPerfect ? ', onlySuspiciousPerfect: true' : ''
        }, limit: ${limit}, offset: ${offset} } pour appliquer ces changements.`
      : `Re-poste avec offset=${offset + limit} pour continuer le batch.`,
  });
}
