/**
 * Re-link Ciqual — répare les liens ingrédient → Ciqual après un ré-import
 * de la base ANSES (qui décale les `id`, rendant les `ciqual_food_id`
 * stockés caducs).
 *
 * Deux phases, sur recipe_sheets ET menu_meal_sheets :
 *   1) Détecte les `ciqual_food_id` MORTS (qui ne pointent plus aucune
 *      ligne ciqual_foods actuelle) → on les vide.
 *   2) Re-matche le label de l'ingrédient avec le VRAI matcher d'import
 *      (`quickMatchCiqual`, alias de Karine inclus) → on réécrit le bon id.
 *
 * Les liens encore valides sont laissés intacts. Les ingrédients jamais
 * liés sont aussi tentés (= comportement auto-link de l'import).
 *
 * Usage (dry-run par défaut, n'écrit RIEN) :
 *   npx tsx scripts/relink-ciqual.mts
 * Pour appliquer réellement les changements :
 *   npx tsx scripts/relink-ciqual.mts --apply
 *
 * Lit les credentials Cloud depuis .env.local (jamais affichés).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  quickMatchCiqual,
  type CiqualAlias,
  type CiqualFoodLite,
} from '../src/lib/nutriscore-aggregate';

const APPLY = process.argv.includes('--apply');
const __dirname = dirname(fileURLToPath(import.meta.url));

// --- credentials (.env.local, sans jamais les imprimer) -------------------
const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const getEnv = (k: string): string => {
  const m = env.match(new RegExp(`^${k}="?([^"\\n\\r]+)"?`, 'm'));
  if (!m) throw new Error(`Variable ${k} absente de .env.local`);
  return m[1];
};
const supabase = createClient(
  getEnv('NEXT_PUBLIC_SUPABASE_URL'),
  getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

// --- types locaux ---------------------------------------------------------
type Ingredient = {
  label?: string;
  ciqual_alim_code?: number | null;
  ciqual_food_id?: number | null;
  [k: string]: unknown;
};
type SheetRow = { id: string; ingredients: Ingredient[] | null };

// --- chargement base Ciqual + alias --------------------------------------
async function loadCiqual(): Promise<{
  foods: CiqualFoodLite[];
  /** id interne (volatile) → alim_code ANSES (stable). */
  alimById: Map<number, number>;
}> {
  const foods: CiqualFoodLite[] = [];
  const alimById = new Map<number, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('ciqual_foods')
      .select('id, name, alim_code')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`ciqual_foods: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: number; name: string; alim_code: number }>;
    // quickMatchCiqual n'utilise que id + name ; le reste peut rester nul.
    for (const r of rows) {
      foods.push({
        id: Number(r.id),
        alim_code: Number(r.alim_code),
        name: String(r.name),
        kcal_per_100g: null,
        proteins_g: null,
        lipids_g: null,
        carbs_g: null,
        fibers_g: null,
        sugars_g: null,
        saturated_fat_g: null,
        salt_g: null,
        sodium_mg: null,
      });
      if (typeof r.alim_code === 'number') alimById.set(Number(r.id), Number(r.alim_code));
    }
    if (rows.length < 1000) break;
  }
  return { foods, alimById };
}

async function loadAliases(): Promise<CiqualAlias[]> {
  const { data, error } = await supabase
    .from('ciqual_aliases')
    .select('alias, ciqual_id, status')
    .eq('status', 'resolved');
  if (error) {
    console.warn(`  ⚠ alias non chargés (${error.message}) — on continue sans.`);
    return [];
  }
  return (data ?? []).map((r: { alias: string; ciqual_id: number }) => ({
    alias: r.alias,
    ciqual_id: Number(r.ciqual_id),
  }));
}

// --- traitement d'une table ----------------------------------------------
type Stats = {
  sheets: number;
  sheetsChanged: number;
  kept: number; // lien encore valide, intact
  rematched: number; // mort/absent → nouveau lien
  cleared: number; // mort/absent → aucun match → vidé
};

async function processTable(
  table: 'recipe_sheets' | 'menu_meal_sheets',
  foods: CiqualFoodLite[],
  alimById: Map<number, number>,
  aliases: CiqualAlias[],
): Promise<Stats> {
  const liveAlimCodes = new Set(alimById.values());
  const stats: Stats = {
    sheets: 0,
    sheetsChanged: 0,
    kept: 0,
    rematched: 0,
    cleared: 0,
  };
  const samples: string[] = [];

  // pagination
  const all: SheetRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select('id, ingredients')
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as SheetRow[];
    all.push(...rows);
    if (rows.length < 1000) break;
  }

  for (const sheet of all) {
    stats.sheets++;
    const ings = Array.isArray(sheet.ingredients) ? sheet.ingredients : [];
    let changed = false;

    const next = ings.map((ing) => {
      const label = (ing.label ?? '').trim();
      const current =
        typeof ing.ciqual_alim_code === 'number' ? ing.ciqual_alim_code : null;
      const aliveByAlim = current !== null && liveAlimCodes.has(current);

      // Déjà lié à un alim_code valide → on garde. On nettoie juste
      // l'ancien champ volatile `ciqual_food_id` s'il traîne encore.
      if (aliveByAlim) {
        stats.kept++;
        if (ing.ciqual_food_id == null) return ing;
        changed = true;
        const rest: Ingredient = { ...ing };
        delete rest.ciqual_food_id;
        return rest;
      }

      // Sinon (mort ou jamais lié) → re-match, puis on écrit le
      // alim_code STABLE (jamais l'id interne).
      const match = label ? quickMatchCiqual(label, foods, aliases) : null;
      const alimCode = match ? alimById.get(match.id) ?? null : null;

      // Déjà dans l'état cible (même alim_code, pas d'ancien id) → no-op.
      if (alimCode === current && ing.ciqual_food_id == null) {
        if (alimCode === null) stats.cleared++;
        else stats.rematched++;
        return ing;
      }

      changed = true;
      if (alimCode !== null) {
        stats.rematched++;
        if (samples.length < 25)
          samples.push(`    ✓ "${label}" → [${alimCode}] ${match!.name}`);
      } else {
        stats.cleared++;
        if (samples.length < 25)
          samples.push(`    ✗ "${label}" → aucun match (lien vidé)`);
      }
      const rest: Ingredient = { ...ing };
      delete rest.ciqual_food_id;
      rest.ciqual_alim_code = alimCode;
      return rest;
    });

    if (changed) {
      stats.sheetsChanged++;
      if (APPLY) {
        const { error } = await supabase
          .from(table)
          .update({ ingredients: next })
          .eq('id', sheet.id);
        if (error) console.warn(`  ⚠ update ${table} ${sheet.id}: ${error.message}`);
      }
    }
  }

  console.log(`\n  ── ${table} ──`);
  console.log(`  fiches: ${stats.sheets} (modifiées: ${stats.sheetsChanged})`);
  console.log(`  liens conservés (valides): ${stats.kept}`);
  console.log(`  re-matchés (nouveau lien): ${stats.rematched}`);
  console.log(`  vidés (aucun match): ${stats.cleared}`);
  if (samples.length) {
    console.log('  échantillon des changements :');
    console.log(samples.join('\n'));
  }
  return stats;
}

// --- main -----------------------------------------------------------------
(async () => {
  console.log(
    APPLY
      ? '⚙  MODE APPLY — écriture réelle des liens.'
      : '🔍 MODE DRY-RUN — aucune écriture. Ajoute --apply pour committer.',
  );
  console.log('Chargement base Ciqual + alias…');
  const { foods, alimById } = await loadCiqual();
  const aliases = await loadAliases();
  console.log(
    `  ciqual_foods: ${foods.length} | alias résolus: ${aliases.length}`,
  );

  await processTable('recipe_sheets', foods, alimById, aliases);
  await processTable('menu_meal_sheets', foods, alimById, aliases);

  console.log(
    APPLY
      ? '\n✅ Terminé — liens écrits en base.'
      : '\n🔍 Dry-run terminé. Relance avec --apply pour écrire.',
  );
})().catch((e) => {
  console.error('ERREUR:', e.message);
  process.exit(1);
});
