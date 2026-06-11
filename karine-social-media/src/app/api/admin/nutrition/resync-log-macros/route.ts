import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/nutrition/resync-log-macros
 *
 * Re-synchronise les macros (proteins_g, lipids_g, carbs_g) des entrées
 * de `food_log_entries` qui sont NULL alors que la fiche source
 * (menu_meal_sheets ou recipe_sheets) a maintenant des macros.
 *
 * Cas d'usage : après application de la migration macros recipe_sheets +
 * lancement du recompute, les anciennes entries du log restent à null.
 * Ce endpoint les rattrape rétroactivement.
 *
 * Body optionnel : { sinceIsoDate?: string } pour limiter aux entrées
 * depuis une date donnée (par défaut : toutes).
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const sinceIsoDate =
    typeof body?.sinceIsoDate === 'string' ? body.sinceIsoDate : null;

  const supabase = createServiceClient();

  // 1) Tire toutes les entries où au moins une macro est null
  //    et qui ont une source 'menu' ou 'recipe' avec un source_ref_id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('food_log_entries')
    .select('id, source, source_ref_id, logged_at, proteins_g, lipids_g, carbs_g')
    .in('source', ['menu', 'recipe'])
    .not('source_ref_id', 'is', null)
    .or('proteins_g.is.null,lipids_g.is.null,carbs_g.is.null');
  if (sinceIsoDate) q = q.gte('logged_at', sinceIsoDate);
  const { data: entries, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  type EntryRow = {
    id: string;
    source: 'menu' | 'recipe';
    source_ref_id: string;
    logged_at: string;
    proteins_g: number | null;
    lipids_g: number | null;
    carbs_g: number | null;
  };
  const entryRows = (entries ?? []) as EntryRow[];

  // 2) Regroupe par source pour batch lookup
  const menuIds = new Set<string>();
  const recipeIds = new Set<string>();
  for (const e of entryRows) {
    if (e.source === 'menu') menuIds.add(e.source_ref_id);
    if (e.source === 'recipe') recipeIds.add(e.source_ref_id);
  }

  // 3) Lookup les macros sources (1 query par table)
  const macrosBySheetId = new Map<
    string,
    { proteins_g: number | null; lipids_g: number | null; carbs_g: number | null }
  >();

  if (menuIds.size > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mms } = await (supabase as any)
      .from('menu_meal_sheets')
      .select('id, proteins_g, lipids_g, carbs_g')
      .in('id', [...menuIds]);
    for (const r of (mms ?? []) as Array<{
      id: string;
      proteins_g: number | null;
      lipids_g: number | null;
      carbs_g: number | null;
    }>) {
      macrosBySheetId.set(String(r.id), {
        proteins_g: r.proteins_g,
        lipids_g: r.lipids_g,
        carbs_g: r.carbs_g,
      });
    }
  }
  if (recipeIds.size > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rs } = await (supabase as any)
      .from('recipe_sheets')
      .select('id, proteins_g, lipids_g, carbs_g')
      .in('id', [...recipeIds]);
    for (const r of (rs ?? []) as Array<{
      id: string;
      proteins_g: number | null;
      lipids_g: number | null;
      carbs_g: number | null;
    }>) {
      macrosBySheetId.set(String(r.id), {
        proteins_g: r.proteins_g,
        lipids_g: r.lipids_g,
        carbs_g: r.carbs_g,
      });
    }
  }

  // 4) Update les entries dont les macros sources sont maintenant connues
  let updated = 0;
  let stillNull = 0;
  for (const e of entryRows) {
    const macros = macrosBySheetId.get(e.source_ref_id);
    if (!macros) {
      stillNull++;
      continue;
    }
    // On n'écrase que les champs qui étaient null côté entry et qui sont
    // maintenant non-null côté source.
    const patch: Record<string, number | null> = {};
    if (e.proteins_g === null && macros.proteins_g !== null)
      patch.proteins_g = macros.proteins_g;
    if (e.lipids_g === null && macros.lipids_g !== null)
      patch.lipids_g = macros.lipids_g;
    if (e.carbs_g === null && macros.carbs_g !== null)
      patch.carbs_g = macros.carbs_g;
    if (Object.keys(patch).length === 0) {
      stillNull++;
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: uErr } = await (supabase as any)
      .from('food_log_entries')
      .update(patch)
      .eq('id', e.id);
    if (!uErr) updated++;
  }

  return NextResponse.json({
    entriesScanned: entryRows.length,
    entriesUpdated: updated,
    entriesStillNull: stillNull,
  });
}
