/**
 * Cleanup orphan assets — V3 nightly job (audit V2 HAUTE).
 *
 * Appelle le RPC plpgsql `cleanup_orphan_assets` (migration 084) qui supprime
 * les rows assets_<type> qui :
 *   - n'ont AUCUNE asset_usage
 *   - ont été créées il y a > p_min_age_minutes (défaut 60)
 *
 * Le délai protège les drafts en cours de commit lazy-create (POST asset
 * puis POST timeline en 2 calls non-atomiques côté UI).
 *
 * Usage :
 *   cd hero/admin && node scripts/cleanup-orphan-assets.mjs
 *   cd hero/admin && node scripts/cleanup-orphan-assets.mjs --min-age=10  (dev)
 *
 * Cron (Linux/macOS) :     0 3 * * * cd /path/admin && node scripts/cleanup-orphan-assets.mjs
 * Cron Windows (Task Sched.) : programme node.exe avec args ./scripts/cleanup-orphan-assets.mjs
 * Vercel cron : envelopper en /api/admin/cleanup-orphan-assets et configurer
 *               vercel.json crons (à faire si on déploie en prod Vercel).
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_ROOT = resolve(__dirname, '..')

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

const env = parseEnvFile(resolve(ADMIN_ROOT, '.env.local'))
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Creds Supabase manquants dans .env.local')

const minAgeArg = process.argv.find(a => a.startsWith('--min-age='))
const minAge = minAgeArg ? parseInt(minAgeArg.split('=')[1], 10) : 60

console.log(`[cleanup-orphan-assets] target=${url} min_age_minutes=${minAge}`)

const sb = createClient(url, key, { auth: { persistSession: false } })

const { data, error } = await sb.rpc('cleanup_orphan_assets', {
  p_min_age_minutes: minAge,
})
if (error) {
  console.error('RPC failed:', error.message)
  process.exit(1)
}

console.log('Result:', JSON.stringify(data, null, 2))
const total = (data?.image ?? 0) + (data?.animation ?? 0)
            + (data?.audio ?? 0) + (data?.text ?? 0)
console.log(`Total orphans deleted: ${total}`)
