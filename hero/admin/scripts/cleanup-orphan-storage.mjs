#!/usr/bin/env node
/**
 * cleanup-orphan-storage.mjs — supprime les fichiers Storage Supabase qui
 * appartiennent à des livres autres que Duke.
 *
 * Refonte 2026-05-12 (cleanup demandé suite à pollution Dev-Studio + Warriors).
 *
 * Usage :
 *   cd hero/admin
 *   node scripts/cleanup-orphan-storage.mjs           # dry-run (liste sans supprimer)
 *   node scripts/cleanup-orphan-storage.mjs --delete  # supprime vraiment
 *
 * Critère "à conserver" :
 *   - Le livre Duke Duo : id = 8a90ccc6-acb0-49c2-a5f2-f3c245b64713
 *   - + tous les fichiers dans des dossiers qui ne sont PAS sous books/{id}
 *     (= studio/ générique, temp/, etc. — laissés intacts par sécurité)
 *
 * Buckets ciblés : images, videos
 * (Bucket audio non touché — banque sons est par-livre mais on ne purge pas
 *  pour V1, safer.)
 *
 * Pré-requis : .env.local avec NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Charge .env.local : cherche en remontant depuis le dossier du script ──

const __dirname = dirname(fileURLToPath(import.meta.url))
function findEnvFile(startDir) {
  let dir = startDir
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, '.env.local')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
const envPath = findEnvFile(__dirname) ?? resolve(process.cwd(), '.env.local')
let envContent = ''
try {
  envContent = readFileSync(envPath, 'utf-8')
  console.log(`📄 .env.local trouvé : ${envPath}`)
} catch {
  console.error(`❌ Impossible de lire .env.local (cherché jusqu'à 5 niveaux au-dessus de ${__dirname})`)
  process.exit(1)
}
// Strip BOM UTF-8 + normalise les fins de ligne Windows
envContent = envContent.replace(/^﻿/, '').replace(/\r\n/g, '\n')
for (const rawLine of envContent.split('\n')) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (m) {
    let value = m[2].trim()
    // Strip quotes éventuelles
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[m[1]] = value
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquante dans .env.local')
  process.exit(1)
}

const DRY_RUN = !process.argv.includes('--delete')
/** Mode 'purge-prefixes' : au lieu du cleanup orphan classique, supprime
 *  TOUT ce qui commence par les préfixes listés ci-dessous (= POCs/tests
 *  obsolètes). Utile pour libérer rapidement le quota Storage.
 *
 *  Usage : node scripts/cleanup-orphan-storage.mjs --purge-prefixes [--delete]
 */
const PURGE_MODE = process.argv.includes('--purge-prefixes')
const PURGE_PREFIXES = ['test/']  // bucket: images uniquement (tests POCs)
/** Mode 'nuke-all' : SUPPRIME TOUT dans les 3 buckets (images, videos, audio).
 *  Aucun filtre. À utiliser avec --delete pour effectivement supprimer.
 *  Usage : node scripts/cleanup-orphan-storage.mjs --nuke-all --delete */
const NUKE_MODE = process.argv.includes('--nuke-all')
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── 1. Livres à CONSERVER (= UUID en dur, fourni par l'auteur) ────────────

const KEEP_BOOK_IDS = ['8a90ccc6-acb0-49c2-a5f2-f3c245b64713']  // Duke Duo

// Hydratation pour log + sanity check
const { data: keepBooks, error: bookErr } = await supabase
  .from('books')
  .select('id, title')
  .in('id', KEEP_BOOK_IDS)
if (bookErr) {
  console.error('❌ Fetch books échoué:', bookErr.message)
  process.exit(1)
}
const keepBookIds = new Set(KEEP_BOOK_IDS)
console.log(`📚 Livres à conserver (${keepBooks.length}) :`)
keepBooks.forEach(b => console.log(`   • ${b.title} (${b.id})`))
if (keepBooks.length !== KEEP_BOOK_IDS.length) {
  console.warn(`⚠ ${KEEP_BOOK_IDS.length - keepBooks.length} ID(s) introuvable(s) en DB — vérifie KEEP_BOOK_IDS dans le script avant de --delete.`)
}
console.log()

// ── Mode NUKE TOTAL : vide les 3 buckets entièrement ────────────────────

if (NUKE_MODE) {
  console.log(`\n☢️  MODE NUKE — vide TOUT dans images, videos, audio. AUCUN FILTRE.`)
  let totalN = 0
  let totalSizeN = 0
  for (const bucket of ['images', 'videos', 'audio']) {
    console.log(`\n🗂  Bucket: ${bucket}`)
    const files = await collectAllFiles(bucket, '')
    if (files.length === 0) {
      console.log(`   ✅ Bucket déjà vide`)
      continue
    }
    const sizeMb = files.reduce((s, f) => s + (f.size ?? 0), 0)
    console.log(`   🧹 ${files.length} fichier(s) (${formatBytes(sizeMb)}) — TOUT sera supprimé`)
    if (DRY_RUN) {
      console.log(`   ⚠ DRY-RUN — relance avec --delete pour exécuter.`)
    } else {
      const batchSize = 100
      let deleted = 0
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize).map(f => f.path)
        const { error: delErr } = await supabase.storage.from(bucket).remove(batch)
        if (delErr) {
          console.error(`   ❌ Batch (${i}-${i + batch.length}):`, delErr.message)
        } else {
          deleted += batch.length
          console.log(`   ✅ ${deleted}/${files.length}`)
        }
      }
    }
    totalN += files.length
    totalSizeN += sizeMb
  }
  console.log(`\n${DRY_RUN ? '🔍 Dry-run' : '☢️  Nuke'} terminé : ${totalN} fichier(s), ${formatBytes(totalSizeN)}`)
  process.exit(0)
}

// ── 2. Mode PURGE par préfixes (= cleanup test/* etc.) ──────────────────

if (PURGE_MODE) {
  console.log(`\n🧨 Mode PURGE-PREFIXES — préfixes ciblés : ${PURGE_PREFIXES.join(', ')}`)
  let totalP = 0
  let totalSizeP = 0
  for (const bucket of ['images', 'videos']) {
    console.log(`\n🗂  Bucket: ${bucket}`)
    for (const prefix of PURGE_PREFIXES) {
      const cleanPrefix = prefix.replace(/\/$/, '')
      const files = await collectAllFiles(bucket, cleanPrefix)
      if (files.length === 0) {
        console.log(`   ✅ Aucun fichier sous ${bucket}/${cleanPrefix}/`)
        continue
      }
      const sizeMb = files.reduce((s, f) => s + (f.size ?? 0), 0)
      console.log(`   🧹 ${cleanPrefix}/ : ${files.length} fichier(s) (${formatBytes(sizeMb)}) :`)
      for (const f of files.slice(0, 5)) console.log(`      - ${f.path}`)
      if (files.length > 5) console.log(`      ... et ${files.length - 5} autres`)
      if (DRY_RUN) {
        console.log(`   ⚠ DRY-RUN — relance avec --delete pour exécuter.`)
      } else {
        const batchSize = 100
        let deleted = 0
        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize).map(f => f.path)
          const { error: delErr } = await supabase.storage.from(bucket).remove(batch)
          if (delErr) {
            console.error(`   ❌ Batch (${i}-${i + batch.length}):`, delErr.message)
          } else {
            deleted += batch.length
            console.log(`   ✅ ${deleted}/${files.length}`)
          }
        }
      }
      totalP += files.length
      totalSizeP += sizeMb
    }
  }
  console.log(`\n${DRY_RUN ? '🔍 Dry-run' : '✅ Purge'} terminée : ${totalP} fichier(s), ${formatBytes(totalSizeP)}`)
  process.exit(0)
}

// ── 3. Mode ORPHAN classique : nettoie books/{nonDuke}/ ──────────────────

const BUCKETS = ['images', 'videos']
let totalCount = 0
let totalSize = 0

for (const bucket of BUCKETS) {
  console.log(`\n🗂  Bucket: ${bucket}`)
  const orphans = await collectOrphanFiles(bucket, 'books')
  if (orphans.length === 0) {
    console.log(`   ✅ Aucun fichier orphelin sous ${bucket}/books/`)
    continue
  }
  console.log(`   🧹 ${orphans.length} fichier(s) à supprimer (${formatBytes(orphans.reduce((s, f) => s + (f.size ?? 0), 0))}) :`)
  // Affiche un échantillon
  for (const f of orphans.slice(0, 10)) {
    console.log(`      - ${f.path} (${formatBytes(f.size ?? 0)})`)
  }
  if (orphans.length > 10) console.log(`      ... et ${orphans.length - 10} autres`)

  if (DRY_RUN) {
    console.log(`   ⚠ DRY-RUN — rien n'est supprimé. Relance avec --delete pour exécuter.`)
  } else {
    // Delete par batch de 100 (limite supabase remove())
    const batchSize = 100
    let deleted = 0
    for (let i = 0; i < orphans.length; i += batchSize) {
      const batch = orphans.slice(i, i + batchSize).map(f => f.path)
      const { error: delErr } = await supabase.storage.from(bucket).remove(batch)
      if (delErr) {
        console.error(`   ❌ Batch delete échoué (${i}-${i + batch.length}):`, delErr.message)
      } else {
        deleted += batch.length
        console.log(`   ✅ Supprimé ${deleted}/${orphans.length}`)
      }
    }
  }
  totalCount += orphans.length
  totalSize += orphans.reduce((s, f) => s + (f.size ?? 0), 0)
}

console.log(`\n${DRY_RUN ? '🔍 Dry-run terminé' : '✅ Cleanup terminé'} : ${totalCount} fichier(s), ${formatBytes(totalSize)}`)

// ─────────────────────────────────────────────────────────────────────────
// ── Helpers ──────────────────────────────────────────────────────────────

/** Liste récursivement TOUS les fichiers sous bucket/prefix (sans filtre).
 *  Utilisé par le mode --purge-prefixes pour vider entièrement un dossier. */
async function collectAllFiles(bucket, prefix) {
  const all = []
  async function walk(p) {
    const { data: items, error } = await supabase.storage
      .from(bucket)
      .list(p, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
    if (error) {
      console.warn(`   ⚠ list ${bucket}/${p} échoué:`, error.message)
      return
    }
    for (const item of items ?? []) {
      const fullPath = p ? `${p}/${item.name}` : item.name
      if (item.id === null) {
        await walk(fullPath)
      } else {
        all.push({ path: fullPath, size: item.metadata?.size ?? 0 })
      }
    }
  }
  await walk(prefix)
  return all
}

/** Liste récursivement tous les fichiers sous bucket/rootPrefix, retourne
 *  ceux dont le 2ème segment (= bookId) n'est PAS dans keepBookIds. */
async function collectOrphanFiles(bucket, rootPrefix) {
  const orphans = []
  async function walk(prefix) {
    const { data: items, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
    if (error) {
      console.warn(`   ⚠ list ${bucket}/${prefix} échoué:`, error.message)
      return
    }
    for (const item of items ?? []) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name
      // item.id null → c'est un dossier (récurser). Sinon c'est un fichier.
      if (item.id === null) {
        await walk(fullPath)
      } else {
        // Identifie le bookId = 2ème segment après books/
        // ex: "books/abc-123/sfx/xyz.mp3" → bookId = "abc-123"
        const segments = fullPath.split('/')
        if (segments[0] === 'books' && segments[1]) {
          const bookId = segments[1]
          if (!keepBookIds.has(bookId)) {
            orphans.push({ path: fullPath, size: item.metadata?.size ?? 0 })
          }
        }
        // Sinon (fichier hors books/, ex: studio/, temp/) → on ne touche pas
      }
    }
  }
  await walk(rootPrefix)
  return orphans
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
