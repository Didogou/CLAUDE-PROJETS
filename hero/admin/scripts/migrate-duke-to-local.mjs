/**
 * Migre le livre Duke Duo (book_id 8a90ccc6-acb0-49c2-a5f2-f3c245b64713)
 * depuis Supabase Cloud vers Supabase Local.
 *
 * Copie :
 *   - 1 row dans `books` (le livre lui-même)
 *   - N rows dans `sections` (avec leur JSONB `images[]` contenant les pellicules)
 *   - N rows dans `choices` (= choix sortants)
 *
 * Les fichiers Storage (videos/images/audio) RESTENT sur Supabase Cloud —
 * leurs URLs publiques fonctionneront toujours depuis la DB locale.
 *
 * Usage :
 *   node scripts/migrate-duke-to-local.mjs
 *
 * Prérequis :
 *   - .env.local.cloud + .env.local.local existent (cf setup local 2026-05-13)
 *   - Supabase Local tourne (`npx supabase start` dans hero/)
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_ROOT = resolve(__dirname, '..')

const DUKE_BOOK_ID = '8a90ccc6-acb0-49c2-a5f2-f3c245b64713'

// ── Helpers : parse .env file ─────────────────────────────────────────────

function parseEnvFile(path) {
  const raw = readFileSync(path, 'utf-8').replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const out = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"'))
        || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[m[1]] = val
  }
  return out
}

const cloudEnv = parseEnvFile(resolve(ADMIN_ROOT, '.env.local.cloud'))
const localEnv = parseEnvFile(resolve(ADMIN_ROOT, '.env.local.local'))

const cloudUrl = cloudEnv.NEXT_PUBLIC_SUPABASE_URL
const cloudKey = cloudEnv.SUPABASE_SERVICE_ROLE_KEY
const localUrl = localEnv.NEXT_PUBLIC_SUPABASE_URL
const localKey = localEnv.SUPABASE_SERVICE_ROLE_KEY

if (!cloudUrl || !cloudKey) throw new Error('Cloud creds missing dans .env.local.cloud')
if (!localUrl || !localKey) throw new Error('Local creds missing dans .env.local.local')

console.log('Cloud URL :', cloudUrl)
console.log('Local URL :', localUrl)
console.log('')

const cloud = createClient(cloudUrl, cloudKey, { auth: { persistSession: false } })
const local = createClient(localUrl, localKey, { auth: { persistSession: false } })

/** Tente un INSERT. Si l'erreur dit "Could not find the 'X' column", strip
 *  cette colonne et retry. Loop jusqu'à 50 colonnes strippées max. Retourne
 *  les colonnes strippées pour log + la liste insérable pour réutilisation. */
async function insertWithSchemaStrip(table, rows, knownStripped = []) {
  const stripped = [...knownStripped]
  let attempt = 0
  while (attempt < 60) {
    const cleaned = rows.map(r => {
      const out = { ...r }
      for (const k of stripped) delete out[k]
      return out
    })
    const { error } = await local.from(table).insert(cleaned)
    if (!error) return { stripped, ok: true }
    // Détecte "Could not find the 'X' column"
    const m = error.message.match(/Could not find the '([^']+)' column/)
    if (m) {
      stripped.push(m[1])
      attempt++
      continue
    }
    // Autre erreur → throw
    throw new Error(`Insert ${table} échec : ${error.message}`)
  }
  throw new Error(`Insert ${table} : trop de colonnes inconnues (${stripped.length})`)
}

// ── Step 1 : fetch + insert book ──────────────────────────────────────────

console.log('1/4 — Fetch book Duke depuis cloud…')
const { data: book, error: bookErr } = await cloud
  .from('books')
  .select('*')
  .eq('id', DUKE_BOOK_ID)
  .single()

if (bookErr || !book) {
  throw new Error(`Fetch book échec : ${bookErr?.message ?? 'pas trouvé'}`)
}
console.log(`  → "${book.title}" trouvé`)

console.log('2/4 — Insert book en local…')
let strippedBookCols = []
{
  // Delete existant éventuel pour idempotence
  await local.from('books').delete().eq('id', DUKE_BOOK_ID)
  const result = await insertWithSchemaStrip('books', [book])
  strippedBookCols = result.stripped
  if (strippedBookCols.length > 0) {
    console.log(`  → OK (colonnes ignorées : ${strippedBookCols.join(', ')})`)
  } else {
    console.log('  → OK')
  }
}

// ── Step 2 : fetch + insert sections (avec leurs images JSONB) ────────────

console.log('3/4 — Fetch + insert sections…')
const { data: sections, error: secErr } = await cloud
  .from('sections')
  .select('*')
  .eq('book_id', DUKE_BOOK_ID)

if (secErr) throw new Error(`Fetch sections échec : ${secErr.message}`)
console.log(`  → ${sections?.length ?? 0} sections trouvées`)

let strippedSecCols = []
if (sections && sections.length > 0) {
  // Delete existants éventuels
  await local.from('sections').delete().eq('book_id', DUKE_BOOK_ID)
  // Insert par lots de 50 pour éviter payload > 5MB
  const BATCH = 50
  for (let i = 0; i < sections.length; i += BATCH) {
    const slice = sections.slice(i, i + BATCH)
    const result = await insertWithSchemaStrip('sections', slice, strippedSecCols)
    strippedSecCols = result.stripped
  }
  if (strippedSecCols.length > 0) {
    console.log(`  → ${sections.length} sections insérées (colonnes ignorées : ${strippedSecCols.join(', ')})`)
  } else {
    console.log(`  → ${sections.length} sections insérées`)
  }
}

// ── Step 3 : fetch + insert choices (FK sur sections) ─────────────────────

console.log('4/4 — Fetch + insert choices…')
const sectionIds = (sections ?? []).map(s => s.id)
if (sectionIds.length > 0) {
  const { data: choices, error: chErr } = await cloud
    .from('choices')
    .select('*')
    .in('section_id', sectionIds)
  if (chErr) throw new Error(`Fetch choices échec : ${chErr.message}`)
  console.log(`  → ${choices?.length ?? 0} choices trouvés`)

  if (choices && choices.length > 0) {
    await local.from('choices').delete().in('section_id', sectionIds)
    let strippedChCols = []
    const BATCH = 100
    for (let i = 0; i < choices.length; i += BATCH) {
      const slice = choices.slice(i, i + BATCH)
      const result = await insertWithSchemaStrip('choices', slice, strippedChCols)
      strippedChCols = result.stripped
    }
    if (strippedChCols.length > 0) {
      console.log(`  → ${choices.length} choices insérés (colonnes ignorées : ${strippedChCols.join(', ')})`)
    } else {
      console.log(`  → ${choices.length} choices insérés`)
    }
  }
}

console.log('')
console.log('✓ Migration Duke terminée. Test :')
console.log(`  → ouvre http://127.0.0.1:54323 (Studio UI local)`)
console.log(`  → ou démarre Hero (npm run dev) qui lira la DB locale`)
