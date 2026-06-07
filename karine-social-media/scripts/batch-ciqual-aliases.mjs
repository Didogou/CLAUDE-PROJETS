#!/usr/bin/env node
/**
 * Génère 3-5 aliases en langage naturel pour chaque aliment Ciqual,
 * via Mistral, et les stocke dans la table `ciqual_aliases`.
 *
 * Pourquoi : Ciqual indexe « catégorie, descripteur » (« Porc, côte,
 * cuite »), mais l'utilisatrice tape l'ordre français naturel
 * (« côte de porc »). Sans aliases, le scoring rate. Cf. migration
 * 20260607100000_ciqual_aliases.sql.
 *
 * Pré-requis env vars (.env.local) :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MISTRAL_API_KEY
 *
 * Le script tape la BDD pointée par NEXT_PUBLIC_SUPABASE_URL. Pour
 * tester en local, lance Supabase local et override l'URL. Pour
 * envoyer vers Cloud Karine, garde les vars de prod.
 *
 * Usage :
 *   # Dry-run par défaut : affiche les aliases, n'insère rien.
 *   node scripts/batch-ciqual-aliases.mjs --group="Viandes, œufs, poissons" --limit=5
 *
 *   # Apply pour vraiment insérer en BDD :
 *   node scripts/batch-ciqual-aliases.mjs --group="Viandes, œufs, poissons" --limit=5 --apply
 *
 *   # Reprendre / skip les aliments déjà traités (idempotent) :
 *   #   par défaut on skip ceux qui ont déjà des aliases
 *   #   --force pour regénérer (mais ça crée des doublons → utiliser
 *   #   --reset-group pour wiper les aliases d'un groupe avant)
 *
 *   # Lister les groupes disponibles (puis exit) :
 *   node scripts/batch-ciqual-aliases.mjs --list-groups
 *
 * Throttle : Mistral free = 1 req/s strict. Le script attend 1100 ms
 * entre chaque appel + retry exponentiel 3/7/15 s sur 429.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Chargement .env.local sans dépendance externe (dotenv n'est pas
// dans package.json). Même pattern que scripts/seed-weight-log.mjs.
try {
  const envPath = join(__dirname, '..', '.env.local');
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (e) {
  console.warn('⚠️  .env.local introuvable, on utilise les vars existantes');
}

// ─── Args parse ──────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error('❌ Manque NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY dans .env.local');
  process.exit(1);
}
if (!MISTRAL_KEY) {
  console.error('❌ Manque MISTRAL_API_KEY dans .env.local');
  process.exit(1);
}

const supabase = createClient(SUPA_URL, SUPA_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Helpers ─────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeAlias(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Appel Mistral avec retry exponentiel sur 429 / 5xx. */
async function mistralCall(prompt, { model = 'mistral-small-latest' } = {}) {
  const backoffs = [3000, 7000, 15000];
  let lastErr = null;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${MISTRAL_KEY}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          temperature: 0.4,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = backoffs[attempt];
        if (wait === undefined) throw new Error(`HTTP ${res.status} (épuisé)`);
        console.warn(`  ⏳ HTTP ${res.status}, retry dans ${wait}ms (essai ${attempt + 1}/${backoffs.length})`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? '';
    } catch (e) {
      lastErr = e;
      const wait = backoffs[attempt];
      if (wait === undefined) break;
      console.warn(`  ⏳ ${e.message}, retry dans ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error('mistralCall: tous les retries épuisés');
}

/** Génère les aliases pour un aliment via Mistral. */
async function generateAliases(food) {
  const prompt = `Tu es un assistant français qui aide à indexer une base de données alimentaire.

Voici un aliment de la base Ciqual (ANSES) :
- Nom : « ${food.name} »
- Groupe : « ${food.group_name ?? '?'} »
- Sous-groupe : « ${food.subgroup_name ?? '?'} »

Donne-moi entre 3 et 5 façons NATURELLES et UNIQUES de désigner cet aliment en français parlé / écrit, comme le ferait une utilisatrice qui logue son repas.

RÈGLES :
- Privilégie l'ordre naturel des mots (ex : « côte de porc » plutôt que « porc, côte »).
- Inclus quelques synonymes courants si pertinents (« côtelette » pour « côte »).
- Ne mets PAS d'adjectifs de cuisson/présentation spécifiques (pas de « dorée », « poêlée », « rôtie ») — l'entrée Ciqual couvre déjà la cuisson dans son nom.
- Ne mets PAS de quantités (pas de « 100g de »).
- Pas de majuscules sauf noms propres. Pas de ponctuation finale.
- Si l'aliment est déjà évident en l'état (« eau », « sel fin »), retourne juste 1-2 variantes minimales ou un tableau vide.

Réponds UNIQUEMENT en JSON dans ce format strict :
{ "aliases": ["...", "...", "..."] }`;

  const raw = await mistralCall(prompt);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`JSON Mistral invalide: ${raw.slice(0, 200)}`);
  }
  const arr = Array.isArray(parsed.aliases) ? parsed.aliases : [];
  return arr
    .filter((a) => typeof a === 'string' && a.trim().length >= 2 && a.trim().length <= 100)
    .map((a) => ({ display: a.trim(), normalized: normalizeAlias(a) }))
    // dédup intra-alimentaire
    .filter((a, i, all) => all.findIndex((x) => x.normalized === a.normalized) === i);
}

// ─── Mode --list-groups ──────────────────────────────────────────────────
if (args['list-groups']) {
  // Supabase limite les SELECT à 1000 rows par défaut (config db-max-rows).
  // On pagine par lots de 1000 pour compter les ~3500 lignes Ciqual.
  const counts = new Map();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('ciqual_foods')
      .select('group_name')
      .not('group_name', 'is', null)
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error('❌ Supabase:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const row of data) counts.set(row.group_name, (counts.get(row.group_name) ?? 0) + 1);
    if (data.length < PAGE) break;
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('Groupes Ciqual disponibles :');
  for (const [g, n] of sorted) console.log(`  ${n.toString().padStart(5)} — ${g}`);
  process.exit(0);
}

// ─── Mode batch ──────────────────────────────────────────────────────────
const groupFilter = args.group ?? args.groups; // string ou array via pipe
const limit = args.limit ? parseInt(args.limit, 10) : 10;
const apply = !!args.apply;
const force = !!args.force;

if (!groupFilter) {
  console.error('❌ Précise --group="Viandes, œufs, poissons" (ou --list-groups pour voir les options).');
  process.exit(1);
}

const groupList =
  typeof groupFilter === 'string' ? groupFilter.split('|').map((s) => s.trim()) : [groupFilter];

console.log(`📋 Mode : ${apply ? 'APPLY (insertion BDD)' : 'DRY-RUN (aucune insertion)'}`);
console.log(`📋 Groupes : ${groupList.join(', ')}`);
console.log(`📋 Limite : ${limit} aliments`);
console.log('');

// Récupère les aliments cibles. Supabase Cloud cap les SELECT à 1000 rows
// par défaut (db-max-rows) malgré .limit(N). On pagine manuellement jusqu'à
// avoir tous les aliments demandés (ou tous ceux dispo dans les groupes).
const foods = [];
const PAGE = 1000;
for (let offset = 0; foods.length < limit; offset += PAGE) {
  const pageSize = Math.min(PAGE, limit - foods.length);
  const { data, error } = await supabase
    .from('ciqual_foods')
    .select('id, alim_code, name, group_name, subgroup_name')
    .in('group_name', groupList)
    .order('alim_code', { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (error) {
    console.error('❌ Supabase:', error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;
  foods.push(...data);
  if (data.length < pageSize) break;
}

if (foods.length === 0) {
  console.error(`❌ Aucun aliment trouvé pour les groupes : ${groupList.join(', ')}`);
  process.exit(1);
}

console.log(`✅ ${foods.length} aliments à traiter\n`);

// Pour chaque aliment, on skip s'il a déjà des aliases (sauf --force)
const stats = { processed: 0, skipped: 0, generated: 0, inserted: 0, errors: 0 };

for (const food of foods) {
  if (!force) {
    const { count } = await supabase
      .from('ciqual_aliases')
      .select('id', { count: 'exact', head: true })
      .eq('ciqual_id', food.id);
    if ((count ?? 0) > 0) {
      console.log(`⏭️  [${food.alim_code}] ${food.name} (${count} aliases existants, --force pour regénérer)`);
      stats.skipped++;
      continue;
    }
  }

  console.log(`🔍 [${food.alim_code}] ${food.name}`);
  try {
    const aliases = await generateAliases(food);
    console.log(`   → ${aliases.length} alias${aliases.length > 1 ? 'es' : ''}: ${aliases.map((a) => `"${a.display}"`).join(', ')}`);
    stats.generated += aliases.length;

    if (apply && aliases.length > 0) {
      const rows = aliases.map((a) => ({
        ciqual_id: food.id,
        alias: a.normalized,
        alias_display: a.display,
        source: 'mistral_batch_v1',
        status: 'pending',
      }));
      const { error: insErr } = await supabase
        .from('ciqual_aliases')
        .upsert(rows, { onConflict: 'ciqual_id,alias', ignoreDuplicates: true });
      if (insErr) {
        console.error(`   ❌ Insert : ${insErr.message}`);
        stats.errors++;
      } else {
        stats.inserted += rows.length;
      }
    }
    stats.processed++;
  } catch (e) {
    console.error(`   ❌ ${e.message}`);
    stats.errors++;
  }

  // Throttle Mistral free : 1 req/s strict. On laisse 1100 ms par sécurité.
  await sleep(1100);
}

console.log('\n📊 Récap :');
console.log(`   Traités    : ${stats.processed}`);
console.log(`   Skip       : ${stats.skipped}`);
console.log(`   Aliases    : ${stats.generated}`);
console.log(`   Insérés    : ${stats.inserted}`);
console.log(`   Erreurs    : ${stats.errors}`);

if (!apply) {
  console.log('\nℹ️  Dry-run terminé. Relance avec --apply pour insérer en BDD.');
}
