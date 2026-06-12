import * as XLSX from 'xlsx';

/**
 * Parser XLSX Ciqual ANSES.
 *
 * Le fichier officiel a des colonnes avec accents, espaces et
 * notation parenthésée — on fait un mapping par mots-clés pour
 * absorber les variations entre années (2020, 2024…).
 *
 * Valeurs cellules :
 *  - nombre direct
 *  - virgule décimale FR (3,5 → 3.5)
 *  - "traces", "-" → null
 *  - "<0,1" → null (on garde 0 pour kcal en revanche)
 */

export type CiqualRow = {
  alim_code: number;
  name: string;
  group_name: string | null;
  subgroup_name: string | null;
  kcal_per_100g: number | null;
  proteins_g: number | null;
  lipids_g: number | null;
  carbs_g: number | null;
  fibers_g: number | null;
  sugars_g: number | null;
  /** AG saturés (g/100g) — critique pour le calcul Nutri-Score précis.
   *  Sans cette colonne on doit estimer à 30% des lipides totaux, ce
   *  qui sous-estime gravement les recettes beurre/fromage/crème. */
  saturated_fat_g: number | null;
  water_g: number | null;
  salt_g: number | null;
  sodium_mg: number | null;
  calcium_mg: number | null;
  iron_mg: number | null;
};

export type CiqualParseResult = {
  rows: CiqualRow[];
  totalRows: number;
  skippedRows: number;
  errors: string[];
  detectedColumns: Record<string, string>;
  sheetUsed: string | null;
  allSheets: string[];
};

const COLUMN_HINTS = {
  alim_code: ['alim_code', 'code aliment'],
  name: ['alim_nom_fr', 'nom français', 'nom francais'],
  group: ['alim_grp_nom_fr', 'groupe', 'grp_nom'],
  subgroup: ['alim_ssgrp_nom_fr', 'sous-groupe', 'sous groupe', 'ssgrp_nom'],
  // ATTENTION : Ciqual 2025 a 4 colonnes "Energie ..." (2 kJ + 2 kcal).
  // On cherche d'abord la version OFFICIELLE Règlement UE 1169 en kcal,
  // sinon n'importe quelle colonne kcal. Pas "énergie" tout court (matche
  // les kJ en premier dans l'ordre du fichier).
  kcal: ['kcal 100 g', '(kcal', 'kcal'],
  proteins: ['protéines', 'proteines'],
  lipids: ['lipides'],
  carbs: ['glucides'],
  fibers: ['fibres alimentaires', 'fibres'],
  sugars: ['sucres'],
  // AG saturés Ciqual ANSES — variantes 2020/2024/2025 :
  //   "AG saturés (g/100 g)" / "AG saturés" / "Acides gras saturés"
  // Hints sans accents (normalize() les retire avant comparaison).
  saturated_fat: [
    'ag satures',
    'ags ',
    'acides gras satures',
    'saturated fatty acids',
  ],
  water: ['eau '],
  salt: ['sel chlorure', 'sel '],
  sodium: ['sodium'],
  calcium: ['calcium'],
  iron: ['fer '],
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function findColumn(headers: string[], hints: string[]): string | null {
  const normalized = headers.map((h) => ({ raw: h, norm: normalize(h) }));
  for (const hint of hints) {
    const nHint = normalize(hint);
    const match = normalized.find((h) => h.norm.includes(nHint));
    if (match) return match.raw;
  }
  return null;
}

function parseCell(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'traces' || lower === 'tr' || lower === '-') return null;
  // "<0,1" / "< 0.1" → null (sous seuil)
  if (lower.startsWith('<')) return null;
  // virgule décimale FR
  const num = parseFloat(trimmed.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function parseAlimCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value !== 'string') return null;
  const n = parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function parseText(value: unknown): string | null {
  if (typeof value !== 'string') {
    if (typeof value === 'number') return String(value);
    return null;
  }
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Sélectionne le bon onglet :
 *  - Priorité 1 : onglet "aliments Ciqual YYYY" → on prend l'année max
 *    (le fichier ANSES embarque 2020 + 2025 ; on veut 2025).
 *  - Priorité 2 : n'importe quel onglet qui a alim_code + alim_nom_fr.
 *  - On exclut explicitement "READ ME", "évolution…" et tout onglet
 *    qui ne ressemble pas à une table d'aliments.
 *
 * Retourne le nom de l'onglet retenu, ou null si aucun ne matche.
 */
function findBestSheet(workbook: XLSX.WorkBook): string | null {
  const sampleRows = (name: string) => {
    const sheet = workbook.Sheets[name];
    const sample = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    });
    return sample;
  };

  // Priorité 1 : "aliments ... YYYY" avec colonnes valides
  // (ANSES 2020 / mix 2020+2025 : onglets nommés "aliments Ciqual YYYY")
  let bestYear = -1;
  let bestName: string | null = null;
  for (const name of workbook.SheetNames) {
    const norm = normalize(name);
    if (norm.includes('read me') || norm.includes('evolution')) continue;
    if (!norm.includes('aliments') && !norm.includes('ciqual')) continue;
    const rows = sampleRows(name);
    if (rows.length === 0) continue;
    const headers = Object.keys(rows[0]);
    if (
      !findColumn(headers, COLUMN_HINTS.alim_code) ||
      !findColumn(headers, COLUMN_HINTS.name)
    )
      continue;
    const m = name.match(/(\d{4})/);
    const year = m ? parseInt(m[1], 10) : 0;
    if (year > bestYear) {
      bestYear = year;
      bestName = name;
    }
  }
  if (bestName) return bestName;

  // Priorité 1bis : onglet "composition nutritionnelle"
  // (ANSES 2025 standalone : un seul onglet de données)
  for (const name of workbook.SheetNames) {
    const norm = normalize(name);
    if (!norm.includes('composition') && !norm.includes('nutritionnelle'))
      continue;
    const rows = sampleRows(name);
    if (rows.length === 0) continue;
    const headers = Object.keys(rows[0]);
    if (
      findColumn(headers, COLUMN_HINTS.alim_code) &&
      findColumn(headers, COLUMN_HINTS.name)
    ) {
      return name;
    }
  }

  // Priorité 2 : scan brut — n'importe quel onglet avec alim_code + nom
  for (const name of workbook.SheetNames) {
    const norm = normalize(name);
    if (norm.includes('read me') || norm.includes('evolution')) continue;
    const rows = sampleRows(name);
    if (rows.length === 0) continue;
    const headers = Object.keys(rows[0]);
    if (
      findColumn(headers, COLUMN_HINTS.alim_code) &&
      findColumn(headers, COLUMN_HINTS.name)
    ) {
      return name;
    }
  }
  return null;
}

export function parseCiqualXlsx(buffer: Buffer): CiqualParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const allSheets = workbook.SheetNames;
  const chosenSheet = findBestSheet(workbook);

  if (!chosenSheet) {
    return {
      rows: [],
      totalRows: 0,
      skippedRows: 0,
      errors: [
        `Aucun onglet exploitable trouvé (cherché : "aliments Ciqual YYYY" avec colonnes alim_code + nom). Onglets présents : ${allSheets.join(', ')}`,
      ],
      detectedColumns: {},
      sheetUsed: null,
      allSheets,
    };
  }

  const sheet = workbook.Sheets[chosenSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });

  if (rows.length === 0) {
    return {
      rows: [],
      totalRows: 0,
      skippedRows: 0,
      errors: [`Onglet "${chosenSheet}" vide`],
      detectedColumns: {},
      sheetUsed: chosenSheet,
      allSheets,
    };
  }

  const headers = Object.keys(rows[0]);
  const cols = {
    alim_code: findColumn(headers, COLUMN_HINTS.alim_code),
    name: findColumn(headers, COLUMN_HINTS.name),
    group: findColumn(headers, COLUMN_HINTS.group),
    subgroup: findColumn(headers, COLUMN_HINTS.subgroup),
    kcal: findColumn(headers, COLUMN_HINTS.kcal),
    proteins: findColumn(headers, COLUMN_HINTS.proteins),
    lipids: findColumn(headers, COLUMN_HINTS.lipids),
    carbs: findColumn(headers, COLUMN_HINTS.carbs),
    fibers: findColumn(headers, COLUMN_HINTS.fibers),
    sugars: findColumn(headers, COLUMN_HINTS.sugars),
    saturated_fat: findColumn(headers, COLUMN_HINTS.saturated_fat),
    water: findColumn(headers, COLUMN_HINTS.water),
    salt: findColumn(headers, COLUMN_HINTS.salt),
    sodium: findColumn(headers, COLUMN_HINTS.sodium),
    calcium: findColumn(headers, COLUMN_HINTS.calcium),
    iron: findColumn(headers, COLUMN_HINTS.iron),
  };

  const errors: string[] = [];
  if (!cols.alim_code) errors.push('Colonne "alim_code" introuvable');
  if (!cols.name) errors.push('Colonne "alim_nom_fr" introuvable');
  if (errors.length > 0) {
    return {
      rows: [],
      totalRows: rows.length,
      skippedRows: rows.length,
      errors,
      detectedColumns: Object.fromEntries(
        Object.entries(cols).map(([k, v]) => [k, v ?? '— manquant —']),
      ),
      sheetUsed: chosenSheet,
      allSheets,
    };
  }

  const out: CiqualRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    const code = parseAlimCode(row[cols.alim_code!]);
    const name = parseText(row[cols.name!]);
    if (code === null || !name) {
      skipped++;
      continue;
    }
    out.push({
      alim_code: code,
      name,
      group_name: cols.group ? parseText(row[cols.group]) : null,
      subgroup_name: cols.subgroup ? parseText(row[cols.subgroup]) : null,
      kcal_per_100g: cols.kcal ? parseCell(row[cols.kcal]) : null,
      proteins_g: cols.proteins ? parseCell(row[cols.proteins]) : null,
      lipids_g: cols.lipids ? parseCell(row[cols.lipids]) : null,
      carbs_g: cols.carbs ? parseCell(row[cols.carbs]) : null,
      fibers_g: cols.fibers ? parseCell(row[cols.fibers]) : null,
      sugars_g: cols.sugars ? parseCell(row[cols.sugars]) : null,
      saturated_fat_g: cols.saturated_fat
        ? parseCell(row[cols.saturated_fat])
        : null,
      water_g: cols.water ? parseCell(row[cols.water]) : null,
      salt_g: cols.salt ? parseCell(row[cols.salt]) : null,
      sodium_mg: cols.sodium ? parseCell(row[cols.sodium]) : null,
      calcium_mg: cols.calcium ? parseCell(row[cols.calcium]) : null,
      iron_mg: cols.iron ? parseCell(row[cols.iron]) : null,
    });
  }

  return {
    rows: out,
    totalRows: rows.length,
    skippedRows: skipped,
    errors: [],
    detectedColumns: Object.fromEntries(
      Object.entries(cols).map(([k, v]) => [k, v ?? '— manquant —']),
    ),
    sheetUsed: chosenSheet,
    allSheets,
  };
}
