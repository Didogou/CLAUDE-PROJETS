#!/usr/bin/env node
/**
 * Pour chaque conflit d'alias (alias avec >1 ciqual_id en status='pending'),
 * envoie à Mistral l'alias + la liste des candidats Ciqual (nom, kcal/100g,
 * groupe, sous-groupe) et lui demande de choisir LE candidat qui correspond
 * le mieux. Met à jour le status en BDD selon sa décision.
 *
 * Pré-requis env vars (.env.local) :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MISTRAL_API_KEY
 *
 * Throttle : Mistral free = 1 req/s strict. Le script attend 1100 ms
 * entre chaque appel + retry exponentiel 3/7/15 s sur 429.
 *
 * Usage :
 *   # Dry-run : montre les décisions Mistral sans toucher la BDD
 *   node scripts/mistral-resolve-conflicts.mjs --limit=10
 *
 *   # Apply : met à jour les status en BDD
 *   node scripts/mistral-resolve-conflicts.mjs --limit=10 --apply
 *
 *   # Sans --limit : traite TOUS les conflits restants
 *   node scripts/mistral-resolve-conflicts.mjs --apply
 *
 * Logique de décision Mistral :
 *   - Renvoie l'index d'1 candidat → ce candidat passe 'resolved',
 *     les autres passent 'rejected'
 *   - Renvoie null (trop ambigu / aucun correct) → on ne touche RIEN,
 *     le conflit reste en pending (Karine devra trancher à la main)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  const envPath = join(__dirname, '..', '.env.local');
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  console.warn('⚠️  .env.local introuvable');
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

if (!SUPA_URL || !SUPA_KEY || !MISTRAL_KEY) {
  console.error('❌ Variables manquantes dans .env.local');
  process.exit(1);
}

const supabase = createClient(SUPA_URL, SUPA_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const apply = !!args.apply;
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
          temperature: 0.1,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = backoffs[attempt];
        if (wait === undefined) throw new Error(`HTTP ${res.status} (épuisé)`);
        console.warn(`  ⏳ HTTP ${res.status}, retry dans ${wait}ms`);
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
  throw lastErr ?? new Error('mistralCall: épuisé');
}

/** Pour 1 conflit, demande à Mistral de choisir un candidat. */
async function resolveOneConflict(alias, candidates) {
  const candidatesText = candidates
    .map(
      (c, i) =>
        `[${i + 1}] ${c.name}  ·  ${c.kcal_per_100g ?? '?'} kcal/100g  ·  ${c.group_name ?? '?'}${c.subgroup_name ? ' / ' + c.subgroup_name : ''}`,
    )
    .join('\n');

  const prompt = `Tu es un expert français en nomenclature alimentaire (base Ciqual ANSES).

Voici un ALIAS (expression naturelle qu'une utilisatrice pourrait taper) :
« ${alias} »

Et voici ${candidates.length} candidats Ciqual auxquels cet alias pourrait correspondre :
${candidatesText}

Choisis LE candidat qui correspond le MIEUX à cet alias, en privilégiant :
- l'ordre naturel des mots (un alias "côte de bœuf" vise plutôt "Bœuf, côte" qu'un autre morceau)
- la version cuite / grillée par défaut SI l'alias ne précise pas "cru"
- la version la PLUS GÉNÉRIQUE si l'alias est court (ex: alias "poulet" → "Poulet, viande" plutôt qu'une recette préparée)
- une seule réponse — pas de match multiple

Réponds STRICTEMENT en JSON dans ce format :
- Si un candidat correspond clairement : { "keepIndex": N, "reason": "courte justification" }
  où N est l'index entre 1 et ${candidates.length}
- Si aucun candidat ne correspond OU si plusieurs sont aussi pertinents (ex: cuit/grillé/poêlé d'un même morceau, sans préférence évidente) : { "keepIndex": null, "reason": "courte justification" }`;

  const raw = await mistralCall(prompt);
  try {
    const parsed = JSON.parse(raw);
    const idx = parsed.keepIndex;
    if (idx === null) return { decision: null, reason: parsed.reason ?? '' };
    if (typeof idx === 'number' && idx >= 1 && idx <= candidates.length) {
      return {
        decision: idx - 1,
        reason: parsed.reason ?? '',
      };
    }
    return { decision: null, reason: `Index invalide: ${idx}` };
  } catch {
    return { decision: null, reason: `JSON invalide: ${raw.slice(0, 100)}` };
  }
}

// ─── Récupère les conflits ──────────────────────────────────────────────
console.log(`📋 Mode : ${apply ? 'APPLY (BDD modifiée)' : 'DRY-RUN'}`);
console.log(`📋 Limite : ${limit === Infinity ? 'aucune' : limit}\n`);

console.log('🔍 Récupération des aliases pending…');
const allPending = [];
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await supabase
    .from('ciqual_aliases')
    .select('id, alias, ciqual_id')
    .eq('status', 'pending')
    .order('alias')
    .range(offset, offset + 999);
  if (error) {
    console.error('❌ Supabase:', error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;
  allPending.push(...data);
  if (data.length < 1000) break;
}
console.log(`   ${allPending.length} aliases pending.`);

const byAlias = new Map();
for (const r of allPending) {
  const list = byAlias.get(r.alias) ?? [];
  list.push(r);
  byAlias.set(r.alias, list);
}
const conflictAliases = [...byAlias.entries()]
  .filter(([, rows]) => new Set(rows.map((r) => r.ciqual_id)).size > 1)
  .slice(0, limit);
console.log(`   ${conflictAliases.length} conflits à traiter (après limite).\n`);

if (conflictAliases.length === 0) {
  console.log('🎉 Aucun conflit à traiter, rien à faire.');
  process.exit(0);
}

// Hydrate les noms / kcal / groupes des candidats
const allCiqualIds = [
  ...new Set(conflictAliases.flatMap(([, rows]) => rows.map((r) => r.ciqual_id))),
];
const ciqualById = new Map();
for (let i = 0; i < allCiqualIds.length; i += 500) {
  const chunk = allCiqualIds.slice(i, i + 500);
  const { data, error } = await supabase
    .from('ciqual_foods')
    .select('id, name, kcal_per_100g, group_name, subgroup_name')
    .in('id', chunk);
  if (error) {
    console.error('❌ Supabase:', error.message);
    process.exit(1);
  }
  for (const row of data ?? []) ciqualById.set(row.id, row);
}

// ─── Boucle de résolution ───────────────────────────────────────────────
const stats = { processed: 0, resolved: 0, kept_ambiguous: 0, errors: 0 };

for (const [alias, rows] of conflictAliases) {
  const candidates = rows
    .map((r) => ciqualById.get(r.ciqual_id))
    .filter(Boolean);

  if (candidates.length < 2) continue;

  console.log(`🤔 « ${alias} » (${candidates.length} candidats)`);

  let decision;
  try {
    decision = await resolveOneConflict(alias, candidates);
  } catch (e) {
    console.error(`   ❌ Mistral: ${e.message}`);
    stats.errors++;
    await sleep(1100);
    continue;
  }

  if (decision.decision === null) {
    console.log(`   ⏸️  Mistral abstient : ${decision.reason}`);
    stats.kept_ambiguous++;
  } else {
    const kept = candidates[decision.decision];
    const rejected = candidates.filter((_, i) => i !== decision.decision);
    console.log(`   ✅ Garde : ${kept.name} (${decision.reason})`);
    for (const rej of rejected) {
      console.log(`   ❌ Rejette : ${rej.name}`);
    }

    if (apply) {
      // Update keep en resolved
      const keepRow = rows.find((r) => r.ciqual_id === kept.id);
      if (keepRow) {
        const { error: e1 } = await supabase
          .from('ciqual_aliases')
          .update({ status: 'resolved' })
          .eq('id', keepRow.id);
        if (e1) console.error(`   ⚠️  update keep: ${e1.message}`);
      }
      // Update rejects
      const rejectIds = rejected
        .map((c) => rows.find((r) => r.ciqual_id === c.id)?.id)
        .filter(Boolean);
      if (rejectIds.length > 0) {
        const { error: e2 } = await supabase
          .from('ciqual_aliases')
          .update({ status: 'rejected' })
          .in('id', rejectIds);
        if (e2) console.error(`   ⚠️  update rejects: ${e2.message}`);
      }
    }
    stats.resolved++;
  }

  stats.processed++;
  await sleep(1100); // throttle Mistral free
}

console.log('\n📊 Récap :');
console.log(`   Conflits traités   : ${stats.processed}`);
console.log(`   Résolus            : ${stats.resolved}`);
console.log(`   Mistral abstient   : ${stats.kept_ambiguous}`);
console.log(`   Erreurs            : ${stats.errors}`);

if (!apply) {
  console.log('\nℹ️  Dry-run. Relance avec --apply pour mettre à jour la BDD.');
}
