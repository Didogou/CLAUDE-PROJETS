import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/sections/[id]/incoming-choices
 *
 * Retourne les choix (avec leur section source) qui pointent vers cette
 * section. Utilisé par le panneau infos du Studio Creator (refonte UX
 * 2026-05-12) pour afficher "Vient de §X" en miroir du "Va vers" déjà
 * dispo via /api/sections/[id].
 *
 * Réponse : Array<{
 *   choice_id, choice_text,
 *   source_section_id, source_section_number, source_section_title
 * }>
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // 1. Fetch all choices targeting this section
    const { data: choices, error: chErr } = await supabaseAdmin
      .from('choices')
      .select('id, label, section_id, sort_order')
      .eq('target_section_id', id)
      .order('sort_order')
    if (chErr) throw chErr
    const rows = choices ?? []
    if (rows.length === 0) return NextResponse.json([])

    // 2. Hydrate les sections sources (number + summary)
    const sourceIds = Array.from(new Set(rows.map(c => c.section_id)))
    const { data: sources, error: sErr } = await supabaseAdmin
      .from('sections')
      .select('id, number, summary')
      .in('id', sourceIds)
    if (sErr) throw sErr
    const sourceById = new Map((sources ?? []).map(s => [s.id, s]))

    const out = rows.map(c => {
      const src = sourceById.get(c.section_id)
      return {
        choice_id: c.id,
        choice_text: c.label,
        source_section_id: c.section_id,
        source_section_number: src?.number ?? null,
        source_section_title: src?.summary ?? null,
      }
    })
    return NextResponse.json(out)
  } catch (err: unknown) {
    // Supabase errors sont des objets {code, message, details, hint}.
    // Extract message si possible, sinon JSON pour debug.
    let message: string
    if (err instanceof Error) message = err.message
    else if (typeof err === 'object' && err !== null && 'message' in err) {
      message = String((err as { message: unknown }).message)
    } else {
      message = JSON.stringify(err)
    }
    console.error('[/api/sections/[id]/incoming-choices GET]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
