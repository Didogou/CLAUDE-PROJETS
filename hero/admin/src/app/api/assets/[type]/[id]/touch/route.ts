/**
 * POST /api/assets/[type]/[id]/touch — bump updated_at de l'asset.
 *
 * Utilisé pour matérialiser un "événement de vie" sur un asset (ex : retrait
 * de la timeline d'une section) sans muter de champ métier. Le trigger DB
 * (cf migrations supabase) re-set updated_at = now() à chaque UPDATE.
 *
 * Sémantique : "no-op functional" — re-écrit `id` sur lui-même pour déclencher
 * le trigger sans modifier de donnée.
 *
 * Refonte chantier 4 (2026-05-16, memory project_hero_studios_architecture).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

const VALID_TYPES = ['image', 'animation', 'audio', 'text'] as const
type AssetType = typeof VALID_TYPES[number]

const TABLE_BY_TYPE: Record<AssetType, string> = {
  image: 'assets_image',
  animation: 'assets_animation',
  audio: 'assets_audio',
  text: 'assets_text',
}

function validateType(t: string): t is AssetType {
  return (VALID_TYPES as readonly string[]).includes(t)
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  try {
    const { type, id } = await params
    if (!validateType(type)) {
      return NextResponse.json({ error: 'type invalide' }, { status: 400 })
    }
    // UPDATE neutre : re-set id sur lui-même. Déclenche le trigger updated_at.
    const { data, error } = await supabaseAdmin
      .from(TABLE_BY_TYPE[type])
      .update({ id })
      .eq('id', id)
      .select('id, updated_at')
      .maybeSingle()
    if (error) throw error
    if (!data) {
      // Draft pas encore committé — no-op silent.
      return NextResponse.json({ touched: false })
    }
    return NextResponse.json({ touched: true, updated_at: data.updated_at })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/assets/[type]/[id]/touch POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
