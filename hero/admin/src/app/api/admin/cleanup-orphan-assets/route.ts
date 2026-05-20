/**
 * /api/admin/cleanup-orphan-assets — Wrapper HTTP du RPC `cleanup_orphan_assets`
 * (migration 084) pour exécution via cron (Vercel cron, Task Scheduler Windows,
 * cron Linux, GitHub Actions, etc.).
 *
 * Sémantique : supprime les rows assets_<type> qui n'ont AUCUNE asset_usage
 * et ont été créées il y a > p_min_age_minutes (défaut 60 minutes — protège
 * les drafts en cours de commit lazy-create).
 *
 * Sécurité V1 : header `X-Cron-Secret` requis si `CRON_SECRET` est défini en
 * env. Sinon endpoint ouvert (= utiliser uniquement en dev / réseau privé).
 *
 * Usage cron Vercel (`vercel.json`) :
 *   {
 *     "crons": [{ "path": "/api/admin/cleanup-orphan-assets?minAge=60", "schedule": "0 3 * * *" }]
 *   }
 *
 * Usage curl manuel :
 *   curl -X POST -H "X-Cron-Secret: <secret>" http://localhost:3000/api/admin/cleanup-orphan-assets?minAge=60
 *
 * Usage GET (Vercel cron exige GET, c'est pour ça qu'on accepte les 2) :
 *   curl -H "X-Cron-Secret: <secret>" http://localhost:3000/api/admin/cleanup-orphan-assets
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

async function handle(req: NextRequest) {
  // ── Auth optionnelle via secret partagé (V1 — pas d'auth utilisateur en place) ──
  // Accepte 3 formats :
  //   - Header `X-Cron-Secret: <secret>`            (manuel curl, scripts)
  //   - Header `Authorization: Bearer <secret>`     (Vercel cron — automatique)
  //   - Query `?secret=<secret>`                    (fallback debug)
  const expectedSecret = process.env.CRON_SECRET
  if (expectedSecret) {
    const authHeader = req.headers.get('authorization') ?? ''
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
    const provided = req.headers.get('x-cron-secret')
      ?? bearerMatch?.[1]
      ?? req.nextUrl.searchParams.get('secret')
    if (provided !== expectedSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const minAgeRaw = req.nextUrl.searchParams.get('minAge')
  const minAge = minAgeRaw ? parseInt(minAgeRaw, 10) : 60
  if (Number.isNaN(minAge) || minAge < 0) {
    return NextResponse.json({ error: 'minAge invalide' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('cleanup_orphan_assets', {
      p_min_age_minutes: minAge,
    })
    if (error) throw error
    const result = data as { image: number; animation: number; audio: number; text: number; cutoff: string }
    const total = (result.image ?? 0) + (result.animation ?? 0) + (result.audio ?? 0) + (result.text ?? 0)
    console.log(`[cleanup-orphan-assets] minAge=${minAge}m total=${total}`, result)
    return NextResponse.json({ ok: true, minAge, total, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cleanup-orphan-assets]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
