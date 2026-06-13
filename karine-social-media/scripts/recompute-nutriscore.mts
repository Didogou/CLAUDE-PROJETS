/**
 * Recompute Nutri-Score (recettes + menus) après le relink Ciqual.
 *
 * - Résout les POIDS DE PORTION par LABEL via Mistral (« 1 gousse d'ail »
 *   → 5g, « 1 grosse tomate » → 180g), mêmes règles que
 *   src/lib/portion-weight.ts. Cache local `scripts/.portion-weight-cache.json`
 *   pour ne PAS re-demander entre dry-run et apply.
 * - Recalcule grade/points/confiance avec aggregateIngredients +
 *   computeNutriscore (mêmes fonctions que la prod).
 * - DRY-RUN par défaut : n'écrit RIEN dans le cloud, affiche le diff.
 * - `--apply` : écrit nutriscore_* sur les fiches + persiste les poids de
 *   portion dans `ingredient_portion_weights`.
 * - `--slug=<slug>` : limite aux fiches d'une recette (test ciblé).
 *
 *   npx tsx scripts/recompute-nutriscore.mts                # dry-run
 *   npx tsx scripts/recompute-nutriscore.mts --slug=6-recettes-de-soupes-froides
 *   npx tsx scripts/recompute-nutriscore.mts --apply        # écrit
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  aggregateIngredients,
  applySaltDefault,
  normalizeLabelKey,
  isMassUnit,
  type CiqualFoodLite,
} from '../src/lib/nutriscore-aggregate';
import { computeNutriscore } from '../src/lib/nutriscore';
import { callMistralJson } from '../src/lib/mistral';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const slugArg = process.argv.find((a) => a.startsWith('--slug='))?.slice(7) ?? '';

const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const get = (k: string): string => {
  const m = env.match(new RegExp(`^${k}="?([^"\\n\\r]+)"?`, 'm'));
  if (!m) throw new Error(`Variable ${k} absente de .env.local`);
  return m[1];
};
const sb = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
process.env.MISTRAL_API_KEY = get('MISTRAL_API_KEY');

const CACHE_PATH = join(__dirname, '.portion-weight-cache.json');

// Mêmes règles que src/lib/portion-weight.ts.
const PW_SYSTEM = `Tu es expert en cuisine et nutrition françaises.

On te donne un ingrédient TEL QU'ÉCRIT dans une recette. Donne le poids
moyen en grammes d'UNE portion/unité de cet ingrédient.

Règles strictes :
- Réponds UNIQUEMENT en JSON : { "grams": <nombre> | null }
- Renvoie null si l'ingrédient se mesure en poids/volume et PAS en pièce :
  liquides (huile, vinaigre, lait, eau, crème), poudres (farine, sucre,
  sel, épices), riz/pâtes/céréales en vrac, fromage râpé.
- Sinon le poids d'UNE unité telle qu'on la compte, en tenant compte du
  MOT D'UNITÉ et de l'ADJECTIF DE TAILLE :
    "gousse d'ail" → 5, "tranche de jambon blanc" → 40, "grosse tomate" → 180,
    "tomate" → 120, "tomate cerise" → 15, "oeuf" → 60, "concombre" → 300,
    "steak haché" → 110, "yaourt nature" → 125, "pâte brisée" → 230,
    "carotte" → 120, "oignon" → 120, "filet de poulet" → 150,
    "feuille de basilic" → 1.
- Sois conservatif (poids moyen courant en supermarché français).`;

async function mistralPortion(label: string): Promise<number | null> {
  try {
    const res = await callMistralJson(
      PW_SYSTEM,
      `Ingrédient (tel qu'écrit) : "${label}"\n\nPoids moyen en grammes d'UNE portion ?`,
      { maxTokens: 64, timeoutMs: 12_000 },
    );
    const j = JSON.parse(res.content) as { grams?: number | null };
    const w = j.grams;
    return typeof w === 'number' && w > 0 && w <= 5_000 ? w : null;
  } catch (e) {
    console.warn(`   ⚠ Mistral échec "${label}": ${(e as Error).message}`);
    return null;
  }
}

// ---- 1. Charge Ciqual ----
const foods: CiqualFoodLite[] = [];
for (let o = 0; ; o += 1000) {
  const { data } = await sb
    .from('ciqual_foods')
    .select(
      'id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g, fibers_g, sugars_g, saturated_fat_g, salt_g, sodium_mg',
    )
    .order('id', { ascending: true })
    .range(o, o + 999);
  const arr = (data ?? []) as any[];
  if (!arr.length) break;
  for (const r of arr) foods.push(r as CiqualFoodLite);
  if (arr.length < 1000) break;
}
const groups = new Map(foods.map((c) => [c.id, (c as any).group_name ?? '']));

// ---- 2. Charge les fiches ----
type Sheet = {
  table: 'recipe_sheets' | 'menu_meal_sheets';
  id: string;
  label: string;
  ingredients: any[];
  grade: string | null;
  points: number | null;
  conf: number | null;
};
const sheets: Sheet[] = [];

let recipeIds: number[] | null = null;
if (slugArg) {
  const { data: r } = await sb.from('recipes').select('id').eq('slug', slugArg).maybeSingle();
  if (!r) throw new Error(`Slug introuvable: ${slugArg}`);
  recipeIds = [(r as any).id];
}
{
  let q = sb
    .from('recipe_sheets')
    .select('id, sheet_index, title, recipe_id, ingredients, nutriscore_grade, nutriscore_points, nutriscore_confidence, recipes(title)')
    .limit(5000);
  if (recipeIds) q = q.in('recipe_id', recipeIds);
  const { data } = await q;
  for (const s of (data ?? []) as any[]) {
    sheets.push({
      table: 'recipe_sheets',
      id: String(s.id),
      label: `${s.recipes?.title ?? '?'} · #${(s.sheet_index ?? 0) + 1}${s.title ? ' ' + s.title : ''}`,
      ingredients: Array.isArray(s.ingredients) ? s.ingredients : [],
      grade: s.nutriscore_grade ?? null,
      points: s.nutriscore_points ?? null,
      conf: s.nutriscore_confidence == null ? null : Number(s.nutriscore_confidence),
    });
  }
}
if (!slugArg) {
  const { data } = await sb
    .from('menu_meal_sheets')
    .select('id, ingredients, nutriscore_grade, nutriscore_points, nutriscore_confidence')
    .limit(5000);
  for (const s of (data ?? []) as any[]) {
    sheets.push({
      table: 'menu_meal_sheets',
      id: String(s.id),
      label: `[menu] ${String(s.id).slice(0, 8)}`,
      ingredients: Array.isArray(s.ingredients) ? s.ingredients : [],
      grade: s.nutriscore_grade ?? null,
      points: s.nutriscore_points ?? null,
      conf: s.nutriscore_confidence == null ? null : Number(s.nutriscore_confidence),
    });
  }
}

// ---- 3. Résout les poids de portion par LABEL (cache local + table + Mistral) ----
const portionWeights = new Map<string, number>(); // labelKey → grams
const localCache: Record<string, number | null> = existsSync(CACHE_PATH)
  ? JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
  : {};
const exampleByKey = new Map<string, string>();
for (const sh of sheets) {
  for (const i of sh.ingredients) {
    if (typeof i.quantity !== 'number' || i.quantity <= 0) continue;
    if (isMassUnit(i.unit)) continue;
    const key = normalizeLabelKey(i.label ?? '');
    if (key && !exampleByKey.has(key)) exampleByKey.set(key, String(i.label).trim());
  }
}
const allKeys = [...exampleByKey.keys()];
// 3a. local cache
const known = new Set<string>();
for (const [k, w] of Object.entries(localCache)) {
  known.add(k);
  if (typeof w === 'number' && w > 0) portionWeights.set(k, w);
}
// 3b. table existante
const fromTable = allKeys.filter((k) => !known.has(k));
for (let i = 0; i < fromTable.length; i += 300) {
  const { data } = await sb
    .from('ingredient_portion_weights')
    .select('label_key, grams')
    .in('label_key', fromTable.slice(i, i + 300));
  for (const r of (data ?? []) as Array<{ label_key: string; grams: number | null }>) {
    known.add(r.label_key);
    localCache[r.label_key] = r.grams == null ? null : Number(r.grams);
    if (r.grams != null && Number(r.grams) > 0) portionWeights.set(r.label_key, Number(r.grams));
  }
}
// 3c. Mistral pour les manquants
const missing = allKeys.filter((k) => !known.has(k));
if (missing.length) {
  console.log(`\n🔎 ${missing.length} poids de portion manquants → Mistral (1 req/s)…`);
  for (let i = 0; i < missing.length; i++) {
    const key = missing[i];
    const ex = exampleByKey.get(key)!;
    const w = await mistralPortion(ex);
    localCache[key] = w;
    if (typeof w === 'number' && w > 0) portionWeights.set(key, w);
    console.log(`   [${i + 1}/${missing.length}] ${ex} → ${w ?? 'null'}`);
    if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 1100));
  }
  writeFileSync(CACHE_PATH, JSON.stringify(localCache, null, 2), 'utf8');
  console.log(`   → cache local écrit`);
}

// ---- 4. Recompute + diff ----
const shows = (g: string | null, c: number | null) => !!g && (c ?? 0) >= 0.5;
type Change = Sheet & { ng: string | null; np: number | null; nc: number };
const changes: Change[] = [];
let unchanged = 0;
for (const sh of sheets) {
  if (sh.ingredients.length === 0) continue;
  const { resolved } = applySaltDefault(sh.ingredients);
  const agg = aggregateIngredients(resolved as any, foods, groups, new Map(), portionWeights);
  const score = agg.totalGrams === 0 ? null : computeNutriscore(agg.per100g, 'GENERIC');
  const ng = score ? score.grade : null;
  const np = score ? score.points : null;
  const nc = agg.totalGrams === 0 ? 0 : Number(agg.confidence.toFixed(3));
  const gradeChanged = sh.grade !== ng;
  const visChanged = shows(sh.grade, sh.conf) !== shows(ng, nc);
  const confChanged = Math.abs((sh.conf ?? 0) - nc) > 0.01;
  if (gradeChanged || visChanged || confChanged) changes.push({ ...sh, ng, np, nc });
  else unchanged++;
}

// ---- 5. Affichage ----
console.log(`\n${'='.repeat(70)}`);
console.log(`Mode : ${APPLY ? '⚠️  APPLY (écrit en cloud)' : '🔍 DRY-RUN (aucune écriture)'}`);
console.log(`Fiches : ${sheets.length} · changements : ${changes.length} · inchangées : ${unchanged}`);
console.log('='.repeat(70));
const tag = (c: Change) => {
  const was = shows(c.grade, c.conf) ? c.grade : '∅(caché)';
  const now = shows(c.ng, c.nc) ? c.ng : '∅(caché)';
  return `${was}→${now}`;
};
for (const c of changes) {
  console.log(`${tag(c).padEnd(16)} conf ${String(c.conf ?? '∅').padEnd(6)}→${c.nc}  ${c.label}`);
}

// ---- 6. Apply ----
if (APPLY) {
  console.log(`\n✍️  Écriture en cloud…`);
  let pwOk = 0;
  for (const [key, w] of Object.entries(localCache)) {
    const { error } = await sb.from('ingredient_portion_weights').upsert({
      label_key: key,
      grams: w,
      example_label: exampleByKey.get(key) ?? null,
      source: 'mistral',
      updated_at: new Date().toISOString(),
    });
    if (!error) pwOk++;
  }
  console.log(`   poids de portion persistés : ${pwOk}`);
  const now = new Date().toISOString();
  let ok = 0;
  for (const c of changes) {
    const { error } = await sb
      .from(c.table)
      .update({
        nutriscore_grade: c.ng,
        nutriscore_points: c.np,
        nutriscore_confidence: c.nc,
        nutriscore_computed_at: now,
      })
      .eq('id', c.id);
    if (!error) ok++;
    else console.warn(`   ⚠ ${c.id}: ${error.message}`);
  }
  console.log(`   fiches mises à jour : ${ok}/${changes.length}`);
  console.log(`\n✅ Terminé.`);
} else {
  console.log(`\n→ DRY-RUN. Pour écrire : npx tsx scripts/recompute-nutriscore.mts --apply`);
}
