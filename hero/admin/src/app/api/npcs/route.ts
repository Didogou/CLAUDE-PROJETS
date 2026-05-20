import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * /api/npcs
 *
 * Endpoints sur la table `npcs` (cf 003_npcs.sql + colonnes ajoutées dans
 * 070+ migrations : portrait_url, voice_id, etc.).
 */

// ──────────────────────────────────────────────────────────────────────────
// GET /api/npcs?bookId=X
//   Liste les NPCs d'un livre.
// ──────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const bookId = req.nextUrl.searchParams.get('bookId')
    if (!bookId) {
      return NextResponse.json({ error: 'bookId requis' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin
      .from('npcs')
      .select('*')
      .eq('book_id', bookId)
      .order('created_at')
    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/npcs GET]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/npcs
//   Crée un NPC dans le livre. Champs supportés (cf migrations 003 / 030 /
//   034 / 070 / 071) :
//     - book_id (req), name (req), type? (default 'allié')
//     - description?
//     - portrait_url? / fullbody_gray_url?      → 2 vues principales du perso
//       (cf 071_npcs_character_views.sql)
//     - appearance?                             → prompt visuel utilisé lors
//       de la génération (sert à la régénération future)
//     - portrait_settings?  (jsonb)             → config de génération
//       (style, gender, engine — cf 070_npc_portrait_settings)
//     - voice_id?                               → ElevenLabs voice_id
//       (cf 030_npc_voice_id, utilisé par β.1 lipsync auto)
// ──────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      book_id?: string
      name?: string
      description?: string | null
      portrait_url?: string | null
      fullbody_gray_url?: string | null
      appearance?: string | null
      portrait_settings?: Record<string, unknown> | null
      voice_id?: string | null
      type?: string
    }
    if (!body.book_id) return NextResponse.json({ error: 'book_id requis' }, { status: 400 })
    if (!body.name)    return NextResponse.json({ error: 'name requis' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('npcs')
      .insert({
        book_id: body.book_id,
        name: body.name,
        description: body.description ?? null,
        portrait_url: body.portrait_url ?? null,
        fullbody_gray_url: body.fullbody_gray_url ?? null,
        appearance: body.appearance ?? null,
        portrait_settings: body.portrait_settings ?? null,
        voice_id: body.voice_id ?? null,
        type: body.type ?? 'allié',
      })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/npcs POST]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
