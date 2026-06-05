#!/usr/bin/env node
/**
 * Génère un historique de pesées réaliste pour un utilisateur sur N mois.
 *
 * Modèle :
 *   - Interpolation linéaire entre `startKg` et `endKg` sur la durée.
 *   - Bruit gaussien (±0.4 kg σ) pour simuler les variations naturelles.
 *   - Cadence aléatoire 3-4 pesées par semaine (jours pas réguliers).
 *
 * Pré-requis env vars (.env.local) :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage :
 *   # Liste les emails des users connus + leur id, puis exit
 *   node scripts/seed-weight-log.mjs --list-users
 *
 *   # Dry-run : montre les pesées qui seraient insérées
 *   node scripts/seed-weight-log.mjs --user-email=foo@bar.com --start-kg=78 --end-kg=72.5 --months=6
 *
 *   # Insère pour de vrai
 *   node scripts/seed-weight-log.mjs --user-email=foo@bar.com --start-kg=78 --end-kg=72.5 --months=6 --apply
 *
 *   # Reset : supprime toutes les pesées existantes de l'user avant d'insérer
 *   node scripts/seed-weight-log.mjs --user-email=foo@bar.com --start-kg=78 --end-kg=72.5 --months=6 --apply --reset
 *
 *   # Variations possibles :
 *     --weeks=24              # au lieu de --months
 *     --frequency=4           # pesées/semaine (défaut 3-4 alterne)
 *     --noise-sigma=0.4       # σ du bruit gaussien (kg)
 *     --user-id=<uuid>        # à la place de --user-email
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Chargement .env.local ---
try {
  const envPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '.env.local',
  );
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  /* pas de .env.local */
}

// --- Args ---
function arg(name, defaultValue = undefined) {
  const idx = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return defaultValue;
  const v = process.argv[idx];
  if (v.includes('=')) return v.split('=')[1];
  return process.argv[idx + 1];
}
const FLAG = (name) => process.argv.includes(`--${name}`);

const LIST_USERS = FLAG('list-users');
const APPLY = FLAG('apply');
const RESET = FLAG('reset');
const USER_EMAIL = arg('user-email');
const USER_ID_ARG = arg('user-id');
const START_KG = Number(arg('start-kg', '75'));
const END_KG = Number(arg('end-kg', '72'));
const MONTHS = arg('months') ? Number(arg('months')) : null;
const WEEKS = arg('weeks') ? Number(arg('weeks')) : null;
const FREQ_PER_WEEK = arg('frequency') ? Number(arg('frequency')) : null;
const NOISE_SIGMA = Number(arg('noise-sigma', '0.4'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    '✗ Manque NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY dans .env.local',
  );
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// --- Helpers ---
/** Boîte-Muller : N(0, σ²). */
function gaussian(sigma = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * sigma;
}

/** Date - N jours. */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(8, 0, 0, 0); // pesée matin
  return d;
}

async function listUsers() {
  console.log('--- Users connus (max 50) ---');
  const { data, error } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 50,
  });
  if (error) {
    console.error('✗ listUsers:', error.message);
    process.exit(1);
  }
  for (const u of data.users) {
    console.log(`${u.id}  ${u.email ?? '(no email)'}  ${u.created_at}`);
  }
}

async function resolveUserId() {
  if (USER_ID_ARG) return USER_ID_ARG;
  if (!USER_EMAIL) {
    console.error(
      '✗ Fournis --user-email=foo@bar.com (ou --user-id=<uuid>, ou --list-users)',
    );
    process.exit(1);
  }
  // Cherche par email
  const { data, error } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 500,
  });
  if (error) {
    console.error('✗ listUsers:', error.message);
    process.exit(1);
  }
  const u = data.users.find(
    (x) => (x.email ?? '').toLowerCase() === USER_EMAIL.toLowerCase(),
  );
  if (!u) {
    console.error(`✗ user "${USER_EMAIL}" introuvable`);
    process.exit(1);
  }
  return u.id;
}

function generatePesees({ totalDays, startKg, endKg, freqPerWeek }) {
  const rows = [];
  // Dates : on choisit des jours aléatoires en respectant ~freq pesées/sem
  const probPerDay = freqPerWeek / 7;
  // De la date la plus ancienne à aujourd'hui
  for (let dayOffset = totalDays - 1; dayOffset >= 0; dayOffset--) {
    if (Math.random() > probPerDay) continue;
    // Heure aléatoire entre 7h et 9h (pesée matin)
    const date = daysAgo(dayOffset);
    date.setHours(7 + Math.floor(Math.random() * 2));
    date.setMinutes(Math.floor(Math.random() * 60));
    // Interpolation linéaire startKg → endKg
    const t = (totalDays - 1 - dayOffset) / Math.max(1, totalDays - 1);
    const baseKg = startKg + (endKg - startKg) * t;
    // Bruit gaussien
    const noise = gaussian(NOISE_SIGMA);
    const kg = Math.max(20, Math.min(300, baseKg + noise));
    rows.push({
      weighed_at: date.toISOString(),
      weight_kg: Math.round(kg * 10) / 10, // 1 décimale
    });
  }
  // Tri ascendant par date
  rows.sort((a, b) => a.weighed_at.localeCompare(b.weighed_at));
  return rows;
}

async function main() {
  if (LIST_USERS) {
    await listUsers();
    return;
  }

  const userId = await resolveUserId();
  const totalDays =
    WEEKS !== null ? WEEKS * 7 : (MONTHS ?? 6) * 30;
  const freqPerWeek =
    FREQ_PER_WEEK !== null ? FREQ_PER_WEEK : 3 + Math.random();

  if (!Number.isFinite(START_KG) || !Number.isFinite(END_KG)) {
    console.error('✗ --start-kg / --end-kg requis (nombres)');
    process.exit(1);
  }

  console.log(`User : ${userId}`);
  console.log(`Période : ${totalDays} jours`);
  console.log(
    `Poids : ${START_KG} kg → ${END_KG} kg (${(END_KG - START_KG).toFixed(1)} kg, ${
      END_KG < START_KG ? 'perte' : 'prise'
    })`,
  );
  console.log(`Cadence : ~${freqPerWeek.toFixed(1)} pesées/semaine`);
  console.log(`Bruit gaussien : σ = ${NOISE_SIGMA} kg`);
  console.log('');

  const rows = generatePesees({
    totalDays,
    startKg: START_KG,
    endKg: END_KG,
    freqPerWeek,
  });
  console.log(`→ ${rows.length} pesées générées`);
  console.log('  Première :', rows[0]?.weighed_at, rows[0]?.weight_kg, 'kg');
  console.log(
    '  Dernière :',
    rows[rows.length - 1]?.weighed_at,
    rows[rows.length - 1]?.weight_kg,
    'kg',
  );

  if (!APPLY) {
    console.log('\n(dry-run — ajoute --apply pour insérer)');
    return;
  }

  if (RESET) {
    console.log('\nRESET : suppression des pesées existantes…');
    const { error } = await sb
      .from('weight_log_entries')
      .delete()
      .eq('user_id', userId);
    if (error) {
      console.error('✗ delete reset:', error.message);
      process.exit(1);
    }
    console.log('  OK');
  }

  console.log('\nInsertion…');
  // Insert en batch (chunk 100 pour éviter payload trop gros)
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((r) => ({
      user_id: userId,
      weighed_at: r.weighed_at,
      weight_kg: r.weight_kg,
    }));
    const { error } = await sb.from('weight_log_entries').insert(slice);
    if (error) {
      console.error(`✗ insert batch ${i}-${i + CHUNK}:`, error.message);
      process.exit(1);
    }
    inserted += slice.length;
    process.stdout.write(`\r  ${inserted}/${rows.length}`);
  }
  console.log('\n✓ Terminé.');
}

main().catch((e) => {
  console.error('✗ fatal:', e);
  process.exit(1);
});
