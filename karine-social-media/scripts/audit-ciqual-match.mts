/**
 * Audit (lecture seule) : pour chaque label d'ingrédient distinct des
 * recettes + menus, affiche ce que `quickMatchCiqual` (dictionnaire de
 * basiques + alias résolus + scoring) va lier dans Ciqual.
 *
 * N'écrit RIEN en base. Produit `ciqual-match-audit.txt` + résumé console.
 *   npx tsx scripts/audit-ciqual-match.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  quickMatchCiqual,
  type CiqualAlias,
  type CiqualFoodLite,
} from '../src/lib/nutriscore-aggregate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const get = (k: string): string => {
  const m = env.match(new RegExp(`^${k}="?([^"\\n\\r]+)"?`, 'm'));
  if (!m) throw new Error(`Variable ${k} absente de .env.local`);
  return m[1];
};
const sb = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

// Base Ciqual (id + alim_code + name suffisent au matcher).
const foods: CiqualFoodLite[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from('ciqual_foods')
    .select('id, alim_code, name')
    .order('id', { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: number; alim_code: number; name: string }>;
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
  }
  if (rows.length < 1000) break;
}

// Alias résolus (Karine).
const { data: al } = await sb
  .from('ciqual_aliases')
  .select('alias, ciqual_id')
  .eq('status', 'resolved');
const aliases: CiqualAlias[] = (al ?? []).map((r: { alias: string; ciqual_id: number }) => ({
  alias: r.alias,
  ciqual_id: Number(r.ciqual_id),
}));

// Labels distincts + nb d'utilisations.
const counts = new Map<string, number>();
for (const t of ['recipe_sheets', 'menu_meal_sheets'] as const) {
  const { data } = await sb.from(t).select('ingredients').limit(5000);
  for (const s of (data ?? []) as Array<{ ingredients: Array<{ label?: string }> | null }>) {
    for (const ing of s.ingredients ?? []) {
      const l = (ing.label ?? '').trim();
      if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }
}

const labels = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
const lines: string[] = [];
let matched = 0;
let unmatched = 0;
for (const label of labels) {
  const m = quickMatchCiqual(label, foods, aliases);
  const n = counts.get(label) ?? 0;
  if (m) {
    matched++;
    lines.push(`${label}  (x${n})\n      → [${m.alim_code}] ${m.name}`);
  } else {
    unmatched++;
    lines.push(`${label}  (x${n})\n      → ✗ AUCUN MATCH`);
  }
}

const header = `# Audit matching ingrédients → Ciqual\n# ${labels.length} labels distincts · ${matched} matchés · ${unmatched} sans match\n`;
writeFileSync(join(__dirname, '..', 'ciqual-match-audit.txt'), header + '\n' + lines.join('\n') + '\n', 'utf8');
console.log(
  `${labels.length} labels distincts · ${matched} matchés · ${unmatched} sans match\n→ ciqual-match-audit.txt écrit.`,
);
