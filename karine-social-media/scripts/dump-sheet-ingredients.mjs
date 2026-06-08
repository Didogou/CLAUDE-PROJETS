#!/usr/bin/env node
/**
 * Dump brut depuis Supabase des ingrédients de toutes les sheets d'une
 * recette donnée. But : voir si la donnée contient réellement des
 * doublons ou si c'est l'affichage qui les agrège.
 *
 * Usage :
 *   node scripts/dump-sheet-ingredients.mjs <slug>
 *
 * Ex :
 *   node scripts/dump-sheet-ingredients.mjs 4-salades-de-pates
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=["']?(.+?)["']?$/);
  if (m) env[m[1]] = m[2];
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/dump-sheet-ingredients.mjs <slug>');
  process.exit(1);
}

const { data: recipe, error: errRecipe } = await supa
  .from('recipes')
  .select('id, slug, title, category')
  .eq('slug', slug)
  .single();
if (errRecipe || !recipe) {
  console.error('❌ Recipe introuvable :', slug, errRecipe?.message);
  process.exit(1);
}

console.log(`\n📦 Recipe ${recipe.id} — "${recipe.title}" (${recipe.category})\n`);

const { data: sheets, error: errSheets } = await supa
  .from('recipe_sheets')
  .select('id, sheet_index, title, ingredients')
  .eq('recipe_id', recipe.id)
  .order('sheet_index', { ascending: true });
if (errSheets) {
  console.error('❌', errSheets.message);
  process.exit(1);
}

console.log(`Found ${sheets.length} sheet(s) en BDD\n`);

let grandTotal = 0;
for (const sheet of sheets) {
  const ingredients = Array.isArray(sheet.ingredients) ? sheet.ingredients : [];
  console.log(`────────────────────────────────────────────────`);
  console.log(`📄 Sheet #${sheet.sheet_index} — "${sheet.title ?? '(sans titre)'}"`);
  console.log(`   id=${sheet.id}`);
  console.log(`   ${ingredients.length} ingrédient(s)\n`);

  // Compteur de doublons par label normalisé
  const byLabel = new Map();
  for (const ing of ingredients) {
    const key = (ing.label ?? '').toLowerCase().trim();
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key).push(ing);
  }

  // Affichage : chaque ingrédient avec son qty/unit/ciqual_food_id
  ingredients.forEach((ing, i) => {
    const dupCount = byLabel.get((ing.label ?? '').toLowerCase().trim()).length;
    const dupTag = dupCount > 1 ? ` ⚠️  ×${dupCount} doublons` : '';
    console.log(
      `   ${String(i + 1).padStart(2, ' ')}. [${ing.category ?? '?'}] ` +
        `${ing.quantity ?? '—'} ${ing.unit ?? ''} ${ing.label}${dupTag}` +
        (ing.ciqual_food_id ? ` (ciqual=${ing.ciqual_food_id})` : ''),
    );
  });

  // Synthèse doublons pour cette sheet
  const doublons = [...byLabel.entries()].filter(([, arr]) => arr.length > 1);
  if (doublons.length > 0) {
    console.log(`\n   🔁 Doublons détectés :`);
    for (const [label, arr] of doublons) {
      console.log(`      - "${label}" × ${arr.length}`);
    }
  }

  grandTotal += ingredients.length;
  console.log();
}

console.log(`────────────────────────────────────────────────`);
console.log(`📊 TOTAL : ${sheets.length} sheets · ${grandTotal} ingrédients cumulés\n`);
