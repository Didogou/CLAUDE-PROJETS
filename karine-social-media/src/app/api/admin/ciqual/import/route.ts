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

  // ⚠️ GARDE-FOU 2026-06-12 : on NE supprime PLUS la table avant import.
  // L'ancien DELETE-all + ré-INSERT changeait tous les `id` (auto-increment)
  // → cassait les liens des recettes ET déclenchait ON DELETE CASCADE sur
  // ciqual_aliases (toute la curation de Karine effacée d'un coup), en plus
  // de remettre image_url à null. Cf. incident.
  //
  // Désormais : UNIQUEMENT un upsert sur `alim_code` (clé STABLE). Les
  // lignes existantes sont mises à jour EN PLACE → id conservé → alias,
  // liens recettes et images préservés.
  //
  // `replaceAll` est conservé mais rendu NON destructif : on tamponne les
  // lignes de ce fichier avec `importStamp`, et on supprime à la fin
  // SEULEMENT les aliments absents du nouveau fichier (codes réellement
  // disparus). Pour un ré-import du fichier ANSES complet → 0 suppression.
  const importStamp = new Date().toISOString();

  const BATCH_SIZE = 500;
  let imported = 0;
  const batchErrors: string[] = [];

  for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
    const batch = parsed.rows
      .slice(i, i + BATCH_SIZE)
      .map((r) => ({ ...rowToDbPayload(r), imported_at: importStamp }));
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

  // Purge SÛRE (replaceAll) : on retire uniquement les aliments NON présents
  // dans ce fichier (tampon != importStamp) — donc des codes réellement
  // disparus. Les lignes ré-importées gardent leur id → alias/liens/images
  // intacts. On ne purge PAS si un batch a échoué (sinon on supprimerait
  // des lignes qui n'ont simplement pas pu être ré-importées).
  if (replaceAll && batchErrors.length === 0) {
    const { error: pruneErr } = await (supabase as any)
      .from('ciqual_foods')
      .delete()
      .neq('imported_at', importStamp);
    if (pruneErr) {
      batchErrors.push(
        `Purge des codes obsolètes impossible : ${pruneErr.message}`,
      );
    }
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
