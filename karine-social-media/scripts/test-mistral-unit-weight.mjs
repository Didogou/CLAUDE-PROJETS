#!/usr/bin/env node
/**
 * Test isolé de l'appel Mistral pour le poids unitaire d'un Ciqual.
 *
 * Usage :
 *   node scripts/test-mistral-unit-weight.mjs "Tomate cerise, crue"
 *   node scripts/test-mistral-unit-weight.mjs "Œuf, cru"
 *   node scripts/test-mistral-unit-weight.mjs "Huile d'olive vierge"
 *
 * Avec --persist : met aussi à jour ciqual_foods.avg_unit_weight_g
 *   node scripts/test-mistral-unit-weight.mjs "Tomate cerise, crue" --persist
 */

import { readFileSync } from 'node:fs';
import https from 'node:https';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=["']?(.+?)["']?$/);
  if (m) env[m[1]] = m[2];
}

if (!env.MISTRAL_API_KEY) {
  console.error('❌ MISTRAL_API_KEY manquante dans .env.local');
  process.exit(1);
}

const args = process.argv.slice(2);
const persist = args.includes('--persist');
const label = args.find((a) => !a.startsWith('--'));

if (!label) {
  console.error('Usage: node scripts/test-mistral-unit-weight.mjs "<label>" [--persist]');
  process.exit(1);
}

const SYSTEM_PROMPT = `Tu es expert en nutrition française.

Tu dois donner le poids moyen en grammes d'UNE unité de l'aliment fourni.

Règles strictes :
- Réponds UNIQUEMENT en JSON: { "grams_per_unit": <nombre> | null }
- Renvoie null si "1 unité" n'a aucun sens pour cet aliment :
  liquides (huile, vinaigre, lait, eau), poudres (farine, sel,
  sucre, épices), pâtes/riz/céréales vrac, fromages râpés/coupés.
- Renvoie un nombre pour les aliments en pièce : 1 tomate, 1 œuf,
  1 carotte, 1 pomme, 1 yaourt, 1 tranche de pain, 1 morceau de sucre…
- Sois conservatif : poids moyen courant en supermarché français.
  Ex : "Tomate cerise, crue" → 15, "Œuf, cru" → 60, "Pomme, crue" → 150.
- N'invente jamais d'unités absurdes (ex: "1 tranche de tomate").`;

function callMistral(systemPrompt, userPrompt) {
  const body = JSON.stringify({
    model: 'mistral-small-latest',
    max_tokens: 64,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.mistral.ai',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf-8');
            const json = JSON.parse(raw);
            const content = json.choices?.[0]?.message?.content ?? null;
            resolve({ raw, content });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

console.log(`\n🔬 Test Mistral pour : "${label}"`);
console.log(`   Modèle : mistral-small-latest`);
console.log(`   Persist BDD : ${persist ? 'OUI' : 'NON (dry run)'}\n`);

const userPrompt = `Aliment : "${label}"\n\nQuel est le poids moyen en grammes d'UNE unité de cet aliment ?`;

const t0 = Date.now();
const { content } = await callMistral(SYSTEM_PROMPT, userPrompt);
const elapsed = Date.now() - t0;

console.log(`⏱️  ${elapsed} ms\n`);
console.log(`📥 Réponse brute Mistral :`);
console.log(`   ${content}\n`);

let parsed;
try {
  parsed = JSON.parse(content);
} catch (e) {
  console.error('❌ JSON invalide');
  process.exit(1);
}

const w = parsed.grams_per_unit;
if (typeof w === 'number' && w > 0 && w <= 10_000) {
  console.log(`✅ Poids unitaire estimé : ${w} g\n`);
} else if (w === null) {
  console.log(`⚠️  Mistral a répondu null : "1 unité n'a pas de sens pour cet aliment"`);
  console.log(`   (Typique pour : huiles, farine, sel, sucre, épices…)\n`);
} else {
  console.error(`❌ Réponse inattendue : ${JSON.stringify(parsed)}`);
  process.exit(1);
}

if (persist) {
  console.log(`💾 Update ciqual_foods en BDD…`);
  const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  // Trouver le Ciqual par nom exact
  const { data: ciqual } = await supa
    .from('ciqual_foods')
    .select('id, name, avg_unit_weight_g')
    .ilike('name', label)
    .limit(1)
    .maybeSingle();
  if (!ciqual) {
    console.error(`   ❌ Aucun ciqual_foods trouvé avec name = "${label}"`);
    process.exit(1);
  }
  console.log(`   Ciqual #${ciqual.id} — "${ciqual.name}"`);
  console.log(`   Avant : avg_unit_weight_g = ${ciqual.avg_unit_weight_g ?? 'NULL'}`);
  const valueToStore = typeof w === 'number' && w > 0 ? w : 0.0001;
  const { error } = await supa
    .from('ciqual_foods')
    .update({
      avg_unit_weight_g: valueToStore,
      avg_unit_weight_source: 'mistral',
      avg_unit_weight_updated_at: new Date().toISOString(),
    })
    .eq('id', ciqual.id);
  if (error) {
    console.error(`   ❌ Update échouée : ${error.message}`);
    console.error(`   (Migration 20260608160000_ciqual_unit_weight appliquée en BDD ?)`);
    process.exit(1);
  }
  console.log(`   Après : avg_unit_weight_g = ${valueToStore}  ✓\n`);
}
