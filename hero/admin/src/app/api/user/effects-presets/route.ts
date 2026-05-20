/**
 * /api/user/effects-presets — Presets perso d'effets vidéo de l'auteur.
 *
 * Refonte 2026-05-15ca — V0 single-tenant : on utilise un user_id placeholder
 * fixe (`DEFAULT_USER_ID`) tant que l'auth n'est pas implémentée. Le scope
 * est cross-books (les presets perso de l'auteur sont dispo partout).
 *
 *   GET    → liste tous les presets de l'auteur (DESC by created_at)
 *   POST   { look_id, modules, overrides, extras, thumbnail_url? }
 *          → crée un preset
 *   DELETE ?id=UUID
 *          → supprime un preset
 *
 * Pas de label en V0 (la thumbnail suffit à identifier visuellement).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

// V0 single-tenant — UUID fixe pour identifier l'auteur dev. Quand l'auth
// arrive : remplacer par lecture du JWT / cookie session côté server.
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_effects_presets')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ presets: data ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/user/effects-presets GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      look_id?: string | null
      modules?: string[]
      overrides?: Record<string, unknown>
      extras?: Record<string, unknown>
      thumbnail_url?: string | null
    }
    const insert = {
      user_id: DEFAULT_USER_ID,
      look_id: body.look_id ?? null,
      modules: Array.isArray(body.modules) ? body.modules : [],
      overrides: body.overrides ?? {},
      extras: body.extras ?? {},
      thumbnail_url: body.thumbnail_url ?? null,
    }
    const { data, error } = await supabaseAdmin
      .from('user_effects_presets')
      .insert(insert)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ preset: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/user/effects-presets POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    const { error } = await supabaseAdmin
      .from('user_effects_presets')
      .delete()
      .eq('id', id)
      .eq('user_id', DEFAULT_USER_ID)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/user/effects-presets DELETE]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
