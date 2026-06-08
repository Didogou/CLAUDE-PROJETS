#!/usr/bin/env node
/**
 * Liste toutes les recettes Karine en BDD pour audit Nutri-Score.
 *
 * Pour chaque recette, affiche :
 *   - nom + slug + catégorie
 *   - nb de fiches détaillées
 *   - pour chaque fiche : ingrédients (label, qty, unit), calories,
 *     portions, et un état "calculable" / "à compléter"
 *
 * Permet de voir avant d'attaquer le Palier 2 :
 *   - Combien de recettes au total
 *   - Si toutes ont leurs ingrédients avec quantités
 *   - Si les unités sont homogènes (g/ml) ou pas (cc, cs, pincée…)
 *   - Patterns de saisie typiques de Karine
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Mini dotenv maison pour éviter une dépendance
const envText = readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=["']?(.+?)["']?$/);
  if (m) env[m[1]] = m[2];
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquants dans .env.local');
  process.exit(1);
}

const supa = createClient(url, key);

console.log('📡 Fetch des recettes…\n');

const { data: recipes, error: errRecipes } = await supa
  .from('recipes')
  .select('id, slug, title, category, status, is_public, published_at')
  .eq('status', 'published')
  .order('published_at', { ascending: false });

if (errRecipes) {
  console.error('❌ Erreur fetch recipes:', errRecipes);
  process.exit(1);
}

const { data: sheets, error: errSheets } = await supa
  .from('recipe_sheets')
  .select('id, recipe_id, sheet_index, title, calories, servings, ingredients')
  .order('recipe_id, sheet_index');

if (errSheets) {
  console.error('❌ Erreur fetch sheets:', errSheets);
  process.exit(1);
}

const sheetsByRecipeId = new Map();
for (const s of sheets) {
  if (!sheetsByRecipeId.has(s.recipe_id)) sheetsByRecipeId.set(s.recipe_id, []);
  sheetsByRecipeId.get(s.recipe_id).push(s);
}

let totalRecipes = recipes.length;
let totalSheets = sheets.length;
let withIngredients = 0;
let withQuantitiesAll = 0;
let withQuantitiesPartial = 0;
let withNoQuantities = 0;
const unitsCount = new Map();

console.log(`\n=== ${totalRecipes} RECETTES PUBLIÉES (${totalSheets} fiches au total) ===\n`);

for (const r of recipes) {
  const rSheets = sheetsByRecipeId.get(r.id) ?? [];
  console.log(`📒 [${r.id}] ${r.title}`);
  console.log(`   slug: ${r.slug}  cat: ${r.category}  public: ${r.is_public ? 'oui' : 'non'}`);
  console.log(`   ${rSheets.length} fiche(s) détaillée(s)`);

  for (const s of rSheets) {
    const ings = Array.isArray(s.ingredients) ? s.ingredients : [];
    if (ings.length > 0) withIngredients++;
    const withQty = ings.filter((i) => typeof i.quantity === 'number' && i.quantity > 0).length;
    let qtyState = '?';
    if (ings.length === 0) qtyState = 'sans ingrédients';
    else if (withQty === ings.length) {
      qtyState = '✓ toutes qty';
      withQuantitiesAll++;
    } else if (withQty > 0) {
      qtyState = `~ ${withQty}/${ings.length} qty`;
      withQuantitiesPartial++;
    } else {
      qtyState = '✗ aucune qty';
      withNoQuantities++;
    }
    console.log(`   └─ sheet #${s.sheet_index} ${s.title ? `"${s.title}"` : ''}`);
    console.log(`      ${ings.length} ingrédient(s) — ${qtyState} — ${s.calories ?? '?'} kcal × ${s.servings} portions`);

    // Pour chaque ingrédient : compte les unités
    for (const i of ings) {
      const u = (i.unit ?? '').trim().toLowerCase() || '(aucune)';
      unitsCount.set(u, (unitsCount.get(u) ?? 0) + 1);
    }

    // Détail des 3 premiers ingrédients
    for (const i of ings.slice(0, 3)) {
      const q = typeof i.quantity === 'number' ? i.quantity : '?';
      const u = i.unit ?? '';
      console.log(`         · ${i.label} (${q} ${u})`);
    }
    if (ings.length > 3) console.log(`         · …(+${ings.length - 3} autres)`);
  }
  console.log();
}

console.log('=== STATISTIQUES GLOBALES ===');
console.log(`Total recettes publiées          : ${totalRecipes}`);
console.log(`Total fiches détaillées          : ${totalSheets}`);
console.log(`  avec ingrédients               : ${withIngredients}`);
console.log(`  ✓ toutes quantités remplies    : ${withQuantitiesAll}`);
console.log(`  ~ quantités partielles         : ${withQuantitiesPartial}`);
console.log(`  ✗ aucune quantité              : ${withNoQuantities}`);

console.log('\n=== UNITÉS UTILISÉES (top 15) ===');
const sortedUnits = [...unitsCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [u, n] of sortedUnits) {
  console.log(`  ${u.padEnd(20)} : ${n}`);
}

console.log('\n✅ Done.');
