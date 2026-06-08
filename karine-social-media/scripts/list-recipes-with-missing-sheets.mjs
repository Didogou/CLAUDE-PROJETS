#!/usr/bin/env node
/**
 * Liste les recettes dont le titre annonce N variantes (« 4 Salades… »,
 * « 3 desserts… ») mais qui n'ont qu'une seule sheet en BDD.
 *
 * Usage :
 *   node scripts/list-recipes-with-missing-sheets.mjs
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=["']?(.+?)["']?$/);
  if (m) env[m[1]] = m[2];
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Fetch toutes les recettes + count par recipe_id
const { data: recipes } = await supa
  .from('recipes')
  .select('id, slug, title, category, status')
  .order('title', { ascending: true });

const { data: sheets } = await supa
  .from('recipe_sheets')
  .select('recipe_id, sheet_index');

const sheetsByRecipe = new Map();
for (const s of sheets ?? []) {
  if (!sheetsByRecipe.has(s.recipe_id)) sheetsByRecipe.set(s.recipe_id, []);
  sheetsByRecipe.get(s.recipe_id).push(s.sheet_index);
}

const NUM_WORDS = {
  deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  neuf: 9, dix: 10, onze: 11, douze: 12,
};

function expectedSheetCount(title) {
  // Cas 1 : nombre en début de titre "4 Salades…"
  const digitMatch = title.match(/^(\d+)\s/);
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    if (n >= 2 && n <= 20) return n;
  }
  // Cas 2 : mot-nombre en début "Quatre salades…", "Trois recettes…"
  const first = title.trim().split(/\s+/)[0]?.toLowerCase();
  if (first && NUM_WORDS[first]) return NUM_WORDS[first];
  return null;
}

console.log('\n📊 Audit des recettes "N variantes" vs sheets réelles :\n');

const issues = [];
for (const r of recipes ?? []) {
  const expected = expectedSheetCount(r.title);
  if (expected === null) continue;
  const actual = (sheetsByRecipe.get(r.id) ?? []).length;
  if (actual === expected) continue;
  issues.push({ recipe: r, expected, actual });
}

if (issues.length === 0) {
  console.log('✅ Toutes les recettes "N variantes" ont le bon nombre de sheets.\n');
  process.exit(0);
}

console.log(`⚠️  ${issues.length} recette(s) avec un écart :\n`);
console.log(
  '  '.padEnd(4) +
    'Annoncé'.padEnd(10) +
    'Réel'.padEnd(7) +
    'Cat.'.padEnd(20) +
    'Status'.padEnd(12) +
    'Titre',
);
console.log('  ' + '─'.repeat(120));

for (const { recipe, expected, actual } of issues) {
  const flag = actual === 1 ? '🔴' : '🟡';
  console.log(
    `  ${flag} ` +
      String(expected).padEnd(9) +
      String(actual).padEnd(6) +
      (recipe.category ?? '').padEnd(20) +
      (recipe.status ?? '').padEnd(12) +
      `${recipe.title}  (${recipe.slug})`,
  );
}

console.log(
  `\nLégende : 🔴 = 1 seule sheet (chantier) | 🟡 = plusieurs mais pas le bon compte\n`,
);
