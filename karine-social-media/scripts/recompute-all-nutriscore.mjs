#!/usr/bin/env node
/**
 * Recalcule + persiste le Nutri-Score pour TOUTES les sheets en BDD.
 * À lancer une fois après l'application de la migration
 * 20260608120000_recipe_sheets_nutriscore.sql.
 *
 * Usage :
 *   node scripts/recompute-all-nutriscore.mjs
 *
 * Lit les credentials Supabase depuis .env.local.
 * Fait un calcul à la fois (séquentiel) — Karine a ~20 recettes,
 * pas besoin de paralléliser.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ====== Charge .env.local ======
const env = {};
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=["']?(.+?)["']?$/);
  if (m) env[m[1]] = m[2];
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ====== Algorithme Nutri-Score 2024 (copie de src/lib/nutriscore.ts) ======
const KCAL_TO_KJ = 4.184;
function scoreFromTable(value, table) {
  let last = 0;
  for (const [threshold, pts] of table) {
    if (value >= threshold) last = pts;
    else break;
  }
  return last;
}
const NEG_ENERGY = [[0,0],[336,1],[672,2],[1008,3],[1344,4],[1680,5],[2010,6],[2350,7],[2690,8],[3030,9],[3370,10]];
const NEG_SUGARS = [[0,0],[3.4,1],[6.8,2],[10,3],[14,4],[17,5],[20,6],[24,7],[27,8],[31,9],[34,10],[37,11],[41,12],[44,13],[48,14],[51,15]];
const NEG_AGS = [[0,0],[1,1],[2,2],[3,3],[4,4],[5,5],[6,6],[7,7],[8,8],[9,9],[10,10]];
const NEG_SODIUM = [[0,0],[80,1],[160,2],[240,3],[320,4],[400,5],[500,6],[600,7],[700,8],[800,9],[900,10],[1000,11],[1100,12],[1200,13],[1300,14],[1400,15],[1500,16],[1600,17],[1700,18],[1800,19],[1900,20]];
const POS_FIBERS = [[0,0],[3,1],[4.1,2],[5.2,3],[6.3,4],[7.4,5]];
const POS_PROTEINS = [[0,0],[2.4,1],[4.8,2],[7.2,3],[9.6,4],[12,5],[14,6],[17,7]];

function scoreFVL(pct) {
  if (pct >= 80) return 5;
  if (pct >= 60) return 2;
  if (pct >= 40) return 1;
  return 0;
}
function gradeFromPoints(points) {
  if (points <= 0) return 'A';
  if (points <= 2) return 'B';
  if (points <= 10) return 'C';
  if (points <= 18) return 'D';
  return 'E';
}
function computeNutriscore(input) {
  const kj = input.kcal * KCAL_TO_KJ;
  const negEnergy = scoreFromTable(kj, NEG_ENERGY);
  const negSugars = scoreFromTable(input.sugars, NEG_SUGARS);
  const negAgs = scoreFromTable(input.saturatedFat, NEG_AGS);
  const negSodium = scoreFromTable(input.sodiumMg, NEG_SODIUM);
  const negativePoints = negEnergy + negSugars + negAgs + negSodium;

  const posFibers = scoreFromTable(input.fibers, POS_FIBERS);
  let posProteins = scoreFromTable(input.proteins, POS_PROTEINS);
  const posFvl = scoreFVL(input.fruitsVegLegumesPct);
  if (negativePoints >= 11 && posFvl < 5) posProteins = 0;

  const positivePoints = posFibers + posProteins + posFvl;
  const points = negativePoints - positivePoints;
  return { grade: gradeFromPoints(points), points };
}

// ====== Conversions unités ======
const UNIT_TO_GRAMS = { g:1, gr:1, gramme:1, grammes:1, kg:1000, ml:1, cl:10, l:1000, cs:15, cc:5, 'c. à soupe':15, 'c. à café':5, 'cuillère à soupe':15, 'cuillère à café':5, pincée:0.5, pincee:0.5, tasse:200, bol:250, verre:200 };

// Pour les ingrédients sans unit (« 8 tomates cerises »), on utilise
// le poids unitaire stocké sur ciqual_foods.avg_unit_weight_g (alimenté
// par Mistral via le persist helper TS). Le batch fait juste un lookup
// BDD : il n'appelle PAS Mistral lui-même.
function unitToGrams(qty, unit, ciqualFoodId, unitWeights) {
  if (typeof qty !== 'number' || qty <= 0) return 0;
  const u = (unit ?? '').trim().toLowerCase();
  if (u) {
    const factor = UNIT_TO_GRAMS[u];
    if (typeof factor === 'number') return qty * factor;
  }
  if (typeof ciqualFoodId === 'number') {
    const w = unitWeights.get(ciqualFoodId);
    if (typeof w === 'number' && w > 0) return qty * w;
  }
  return 0;
}

// ====== Quick match Ciqual ======
// IMPORTANT : doit rester en SYNC avec src/lib/nutriscore-aggregate.ts
const stem = t => (t.length >= 5 && t.endsWith('s') ? t.slice(0, -1) : t);
const normKeep = s => s.toLowerCase();
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
const STOP_WORDS = new Set(['de','du','des','et','ou','au','aux','avec','sans','en','le','la','les','un','une','plus','bien','tres','mure','mur','mature','frai','frais','fraiche','fraich','pepite','morceau','tranche','rondelle','gousse','feuille','feuilles','cube','cubes','dose','doses','pincee','pincees']);
const MEAT_KEYWORDS = new Set(['poulet','dinde','boeuf','porc','agneau','veau','canard','lapin','jambon','saucisse','magret','bavette','entrecote','rumsteck','gigot','cordon','nugget','viande','poulets','dindes','jambons','saucisses','magrets']);
const RAW_RE = /\b(cru|crue|crus|crues)\b/;
const COOKED_RE = /\b(cuit|cuite|cuits|cuites|grill|r[ôo]ti|po[êe]l|brais|appert|vapeur|frit|frite|bouilli|blanchi|confit|mijot)/;
const LABEL_EXPLICIT_RAW_RE = /\b(cru|crue|crus|crues|tartare|carpaccio|sashimi)\b/;
const TRANSFORMED_RE = /\b(poudre|moulu|moulue|s[ée]che|s[ée]chee|s[ée]chees|sec|d[ée]shydrat|lyophilis|nectar|jus de|au sirop|en sirop|appertis|conserve|en bo[iî]te|congel|surgel)\b/;
const LABEL_TRANSFORMATION_RE = /\b(poudre|moulu|moulue|s[ée]che|sec|d[ée]shydrat|lyophilis|nectar|jus|sirop|appertis|conserve|en bo[iî]te|congel|surgel|en bocal)\b/;
const splitRe = /[\s,()/'’0-9%]+/;

function quickMatchCiqual(label, ciqualFoods, aliases) {
  // PRIORITE ABSOLUE aux aliases resolus (manuel via /admin/recettes/ciqual-base).
  if (aliases && aliases.length > 0) {
    const labelNormFull = norm(label).trim().replace(/\s+/g, ' ');
    for (const a of aliases) {
      const aliasNorm = norm(a.alias).trim().replace(/\s+/g, ' ');
      if (aliasNorm === labelNormFull) {
        const f = ciqualFoods.find((c) => c.id === a.ciqual_id);
        if (f) return f;
      }
    }
  }
  const labelKeep = normKeep(label);
  const labelStrip = norm(label);
  const tokensKeepRaw = labelKeep.split(splitRe).filter(t => t.length >= 3);
  const tokensKeep = tokensKeepRaw.map(stem);
  const tokensStrip = labelStrip.split(splitRe).filter(t => t.length >= 3).map(stem);
  const rawTokens = [];
  for (let i = 0; i < tokensStrip.length; i++) {
    if (!STOP_WORDS.has(tokensStrip[i])) rawTokens.push({ keepRaw: tokensKeepRaw[i], keep: tokensKeep[i], strip: tokensStrip[i] });
  }
  if (rawTokens.length === 0) return null;
  const isMeatLabel = rawTokens.some(t => MEAT_KEYWORDS.has(t.strip)) && !LABEL_EXPLICIT_RAW_RE.test(labelStrip);
  const labelHasTransform = LABEL_TRANSFORMATION_RE.test(labelStrip);
  let bestScore = 0, best = null;
  for (const f of ciqualFoods) {
    const fnameKeep = normKeep(f.name);
    const fnameStrip = norm(f.name);
    const fnameWordsKeepRaw = new Set(fnameKeep.split(splitRe).filter(w => w.length >= 3));
    const fnameWordsKeep = new Set([...fnameWordsKeepRaw].map(stem));
    const fnameWordsStrip = new Set(fnameStrip.split(splitRe).filter(w => w.length >= 3).map(stem));
    let matched = 0, score = 0;
    rawTokens.forEach((t, idx) => {
      let isMatch = false;
      if (fnameWordsKeep.has(t.keep)) isMatch = true;
      else if (t.keep === t.strip && fnameWordsStrip.has(t.strip)) isMatch = true;
      if (isMatch) {
        const w = idx === 0 ? 2 : 1;
        score += t.strip.length * w;
        matched++;
        if (fnameWordsKeepRaw.has(t.keepRaw)) score += 5;
      }
    });
    if (matched === 0) continue;
    if (matched > 1) score += (matched - 1) * 10;
    if (matched === rawTokens.length) score += 20;
    if (rawTokens.some(t => fnameStrip.startsWith(t.strip))) score += 5;
    if (rawTokens[0] && fnameStrip.startsWith(rawTokens[0].strip + ',')) score += 10;
    score -= Math.max(0, f.name.length - 15) * 0.25;
    if (isMeatLabel) {
      if (RAW_RE.test(fnameStrip)) score -= 15;
      if (COOKED_RE.test(fnameStrip)) score += 10;
    }
    if (!labelHasTransform && TRANSFORMED_RE.test(fnameStrip)) score -= 12;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return bestScore >= 6 ? best : null;
}

// ====== Auto-link Ciqual : pour les ingredients sans ciqual_food_id,
//        on cherche un match et on l'attache (mutation locale) pour que
//        l'écriture finale persiste le lien dans la jsonb ingredients. ======
// Règle ANSES "sel par défaut" : qty=null + label contient "sel" → 0.5g.
// Cf. src/lib/nutriscore-aggregate.ts applySaltDefault().
function applySaltDefault(ingredients) {
  let mutated = false;
  const out = ingredients.map((ing) => {
    if (typeof ing.quantity === 'number' && ing.quantity > 0) return ing;
    const lower = (ing.label ?? '').toLowerCase().trim();
    if (!/\bsel\b/.test(lower)) return ing;
    mutated = true;
    return { ...ing, quantity: 0.5, unit: 'g' };
  });
  return { resolved: out, mutated };
}

// Flag CLI : `node scripts/recompute-all-nutriscore.mjs --force-rematch`
// → re-evalue TOUS les ingredients, ecrase les anciens ciqual_food_id
// avec le resultat du nouvel algo. Utile apres un fix algo (sinon les
// vieux matches buggés restent en BDD).
const FORCE_REMATCH = process.argv.includes('--force-rematch');

function autoLinkCiqual(ingredients, ciqualFoods, aliases) {
  let mutated = false;
  const out = ingredients.map((ing) => {
    if (!FORCE_REMATCH && typeof ing.ciqual_food_id === 'number') return ing;
    const m = quickMatchCiqual(ing.label, ciqualFoods, aliases);
    if (!m) return ing;
    if (ing.ciqual_food_id === m.id) return ing;
    mutated = true;
    return { ...ing, ciqual_food_id: m.id };
  });
  return { resolved: out, mutated };
}

// ====== Aggrégation ingrédients ======
function aggregateIngredients(ingredients, ciqualFoods, ciqualGroups, unitWeights) {
  let totalGrams = 0, totalGramsMatched = 0;
  let totalKcal = 0, totalProteins = 0, totalSugars = 0, totalFibers = 0, totalLipids = 0, totalSodium = 0, fvlGrams = 0;
  for (const ing of ingredients) {
    if (typeof ing.quantity !== 'number' || ing.quantity <= 0) continue;
    const grams = unitToGrams(ing.quantity, ing.unit, ing.ciqual_food_id, unitWeights);
    if (grams <= 0) continue;
    totalGrams += grams;
    let match = null;
    if (typeof ing.ciqual_food_id === 'number') {
      match = ciqualFoods.find(f => f.id === ing.ciqual_food_id) ?? null;
    }
    if (!match) match = quickMatchCiqual(ing.label, ciqualFoods);
    if (!match) continue;
    totalGramsMatched += grams;
    const kcal = match.kcal_per_100g ?? 0;
    const proteins = match.proteins_g ?? 0;
    const sugars = match.sugars_g ?? 0;
    const fibers = match.fibers_g ?? 0;
    const lipids = match.lipids_g ?? 0;
    const sodiumPer100 = match.sodium_mg ?? (match.salt_g ?? 0) * 400;
    totalKcal += (grams * kcal) / 100;
    totalProteins += (grams * proteins) / 100;
    totalSugars += (grams * sugars) / 100;
    totalFibers += (grams * fibers) / 100;
    totalLipids += (grams * lipids) / 100;
    totalSodium += (grams * sodiumPer100) / 100;
    const group = (ciqualGroups.get(match.id) ?? '').toLowerCase();
    if (/fruit|legume|légume|legumineuse|légumineuse/.test(group)) fvlGrams += grams;
  }
  if (totalGramsMatched === 0) return { per100g: null, confidence: 0, totalGrams };
  const factor = 100 / totalGramsMatched;
  return {
    per100g: {
      kcal: totalKcal * factor,
      sugars: totalSugars * factor,
      saturatedFat: (totalLipids * factor) * 0.3,
      sodiumMg: totalSodium * factor,
      fibers: totalFibers * factor,
      proteins: totalProteins * factor,
      fruitsVegLegumesPct: (fvlGrams / totalGramsMatched) * 100,
    },
    confidence: totalGrams === 0 ? 0 : totalGramsMatched / totalGrams,
    totalGrams,
  };
}

// ====== MAIN ======
console.log('📡 Fetch Ciqual (paginé, avec avg_unit_weight_g)…');
const ciqualAll = [];
for (let offset = 0; offset < 10000; offset += 1000) {
  const { data } = await supa
    .from('ciqual_foods')
    .select('id, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g, fibers_g, sugars_g, salt_g, sodium_mg, avg_unit_weight_g')
    .order('id', { ascending: true })
    .range(offset, offset + 999);
  if (!data || data.length === 0) break;
  ciqualAll.push(...data);
  if (data.length < 1000) break;
}
const ciqualGroups = new Map(ciqualAll.map(c => [c.id, c.group_name ?? '']));
// Map<ciqual_id, grams_per_unit> alimentée par Mistral via le persist
// helper TS. Sentinel 0.0001 = "1 unité n'a pas de sens" → on ignore.
const ciqualUnitWeights = new Map(
  ciqualAll
    .filter(c => typeof c.avg_unit_weight_g === 'number' && c.avg_unit_weight_g > 0.01)
    .map(c => [c.id, Number(c.avg_unit_weight_g)]),
);
console.log(`✓ ${ciqualAll.length} aliments Ciqual chargés (${ciqualUnitWeights.size} avec poids unitaire)`);

console.log('\n📡 Fetch aliases résolus…');
const aliases = [];
for (let offset = 0; offset < 100000; offset += 1000) {
  const { data } = await supa
    .from('ciqual_aliases')
    .select('ciqual_id, alias')
    .eq('status', 'resolved')
    .order('id', { ascending: true })
    .range(offset, offset + 999);
  if (!data || data.length === 0) break;
  aliases.push(...data);
  if (data.length < 1000) break;
}
console.log(`✓ ${aliases.length} aliases résolus chargés (priorite absolue dans le matching)`);

console.log('\n📡 Fetch toutes les sheets…');
const { data: sheets } = await supa
  .from('recipe_sheets')
  .select('id, recipe_id, ingredients, title');
console.log(`✓ ${sheets?.length ?? 0} sheets à traiter\n`);

let ok = 0, skipped = 0, errors = 0;
for (const sheet of sheets ?? []) {
  const ingredients = Array.isArray(sheet.ingredients) ? sheet.ingredients : [];
  const label = (sheet.title || `sheet ${sheet.id.slice(0, 8)}`).padEnd(40).slice(0, 40);
  if (ingredients.length === 0) {
    await supa.from('recipe_sheets').update({
      nutriscore_grade: null, nutriscore_points: null, nutriscore_confidence: null,
      nutriscore_computed_at: new Date().toISOString(),
    }).eq('id', sheet.id);
    console.log(`⏭️  ${label} — sans ingrédients`);
    skipped++;
    continue;
  }
  const salted = applySaltDefault(ingredients);
  const linked = autoLinkCiqual(salted.resolved, ciqualAll, aliases);
  const resolved = linked.resolved;
  const mutated = salted.mutated || linked.mutated;
  const agg = aggregateIngredients(resolved, ciqualAll, ciqualGroups, ciqualUnitWeights);
  if (!agg.per100g) {
    await supa.from('recipe_sheets').update({
      nutriscore_grade: null, nutriscore_points: null, nutriscore_confidence: 0,
      nutriscore_computed_at: new Date().toISOString(),
      ...(mutated ? { ingredients: resolved } : {}),
    }).eq('id', sheet.id);
    console.log(`⏭️  ${label} — aucun ingrédient matchable`);
    skipped++;
    continue;
  }
  const score = computeNutriscore(agg.per100g);
  const { error } = await supa.from('recipe_sheets').update({
    nutriscore_grade: score.grade,
    nutriscore_points: score.points,
    nutriscore_confidence: Number(agg.confidence.toFixed(3)),
    nutriscore_computed_at: new Date().toISOString(),
    ...(mutated ? { ingredients: resolved } : {}),
  }).eq('id', sheet.id);
  if (error) {
    console.log(`❌ ${label} — ${error.message}`);
    errors++;
  } else {
    console.log(`✓ ${label} → ${score.grade} (${Math.round(agg.confidence * 100)} % conf)`);
    ok++;
  }
}

console.log(`\n📊 Bilan : ${ok} OK · ${skipped} skipped · ${errors} erreurs`);
