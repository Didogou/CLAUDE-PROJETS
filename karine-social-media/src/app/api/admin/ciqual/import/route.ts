import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';
import { parseCiqualXlsx, type CiqualRow } from '@/lib/ciqual-parser';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/ciqual/import
 *
 * Multipart/form-data :
 *  - file : XLSX Ciqual ANSES
 *  - replaceAll : '1' pour purger la table avant insert, sinon upsert
 *    sur alim_code.
 *
 * Le parser est tolérant aux variations de colonnes (2020/2024…)
 * et normalise les nombres FR (virgule décimale, "traces", "-").
 *
 * Retourne :
 *  { totalRows, importedRows, skippedRows, errors, detectedColumns }
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Form invalide (multipart/form-data attendu)' },
      { status: 400 },
    );
  }

  const file = formData.get('file');
  const replaceAll = formData.get('replaceAll') === '1';
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Fichier vide' }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'Fichier trop volumineux (max 20 Mo)' },
      { status: 413 },
    );
  }

  let parsed;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    parsed = parseCiqualXlsx(buffer);
  } catch (e) {
    const msg = 'Erreur serveur';
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  if (parsed.errors.length > 0) {
    return NextResponse.json(
      {
        error: parsed.errors.join(' ; '),
        detectedColumns: parsed.detectedColumns,
        sheetUsed: parsed.sheetUsed,
        allSheets: parsed.allSheets,
      },
      { status: 422 },
    );
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: 'Aucune ligne exploitable détectée' },
      { status: 422 },
    );
  }

  const supabase = createServiceClient();

  if (replaceAll) {
    const { error: delErr } = await (supabase as any)
      .from('ciqual_foods')
      .delete()
      // delete-all garde-fou : on cible alim_code > 0 (tous les codes
      // Ciqual valides), évite delete sans where qui serait refusé par
      // certains setups Supabase.
      .gt('alim_code', 0);
    if (delErr) {
      return NextResponse.json(
        { error: `Purge impossible : ${delErr.message}` },
        { status: 500 },
      );
    }
  }

  const BATCH_SIZE = 500;
  let imported = 0;
  const batchErrors: string[] = [];

  for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
    const batch = parsed.rows.slice(i, i + BATCH_SIZE).map(rowToDbPayload);
    const { error: upErr } = await (supabase as any)
      .from('ciqual_foods')
      .upsert(batch, { onConflict: 'alim_code' });
    if (upErr) {
      batchErrors.push(
        `Batch ${i / BATCH_SIZE + 1} (lignes ${i + 1}-${i + batch.length}) : ${upErr.message}`,
      );
      continue;
    }
    imported += batch.length;
  }

  return NextResponse.json({
    totalRows: parsed.totalRows,
    importedRows: imported,
    skippedRows: parsed.skippedRows,
    errors: batchErrors,
    detectedColumns: parsed.detectedColumns,
    sheetUsed: parsed.sheetUsed,
    allSheets: parsed.allSheets,
  });
}

function rowToDbPayload(r: CiqualRow) {
  return {
    alim_code: r.alim_code,
    name: r.name,
    group_name: r.group_name,
    subgroup_name: r.subgroup_name,
    kcal_per_100g: r.kcal_per_100g,
    proteins_g: r.proteins_g,
    lipids_g: r.lipids_g,
    carbs_g: r.carbs_g,
    fibers_g: r.fibers_g,
    sugars_g: r.sugars_g,
    saturated_fat_g: r.saturated_fat_g,
    water_g: r.water_g,
    salt_g: r.salt_g,
    sodium_mg: r.sodium_mg,
    calcium_mg: r.calcium_mg,
    iron_mg: r.iron_mg,
  };
}
