/**
 * Audit (lecture seule) : liste les labels d'ingrédients (recettes + menus)
 * que `quickMatchCiqual` ne parvient PAS à lier dans Ciqual.
 *
 * Tri par usage décroissant (on traite les plus fréquents d'abord) et
 * numérotation pour la revue 10 par 10. N'écrit RIEN en base.
 *   npx tsx scripts/audit-ciqual-unmatched.mts
 * Produit `ciqual-unmatched.txt` + résumé console.
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

// Labels distincts + nb d'utilisations + d'où ils viennent (R=recette, M=menu).
const counts = new Map<string, number>();
const origin = new Map<string, Set<string>>();
const TABLES = [
  ['recipe_sheets', 'R'],
  ['menu_meal_sheets', 'M'],
] as const;
for (const [t, tag] of TABLES) {
  const { data } = await sb.from(t).select('ingredients').limit(5000);
  for (const s of (data ?? []) as Array<{ ingredients: Array<{ label?: string }> | null }>) {
    for (const ing of s.ingredients ?? []) {
      const l = (ing.label ?? '').trim();
      if (!l) continue;
      counts.set(l, (counts.get(l) ?? 0) + 1);
      if (!origin.has(l)) origin.set(l, new Set());
      origin.get(l)!.add(tag);
    }
  }
}

// Garde uniquement les sans-match, trié par usage décroissant.
const unmatched: Array<{ label: string; n: number; from: string }> = [];
let total = 0;
for (const label of counts.keys()) {
  total++;
  if (quickMatchCiqual(label, foods, aliases)) continue;
  unmatched.push({
    label,
    n: counts.get(label) ?? 0,
    from: [...(origin.get(label) ?? [])].sort().join('+'),
  });
}
unmatched.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'fr'));

const lines = unmatched.map(
  (u, i) => `${String(i + 1).padStart(3, ' ')}. ${u.label}  (x${u.n}, ${u.from})`,
);
const header =
  `# Ingrédients SANS correspondance Ciqual\n` +
  `# ${total} labels distincts · ${unmatched.length} sans match\n` +
  `# (tri par usage décroissant · R=recette M=menu)\n`;
writeFileSync(join(__dirname, '..', 'ciqual-unmatched.txt'), header + '\n' + lines.join('\n') + '\n', 'utf8');
console.log(
  `${total} labels distincts · ${unmatched.length} SANS match\n→ ciqual-unmatched.txt écrit.`,
);
