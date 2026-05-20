import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * POST /api/plans/reorder
 *
 * Réordonne les Plans d'une section en batch (drag & drop dans la timeline).
 *
 * Body : { sectionId: string, planIds: string[] }
 *   planIds = ordre désiré (0-indexé). Chaque id doit appartenir à la section.
 *
 * Implémentation : update sort_order = idx pour chaque planId dans l'array.
 * Pas de transaction (Supabase JS client n'expose pas de tx multi-statement
 * facilement). Naïf V1 — risque d'état incohérent en concurrent, OK pour
 * l'admin single-user actuel.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sectionId?: string
      planIds?: string[]
    }

    if (!body.sectionId) {
      return NextResponse.json({ error: 'sectionId requis' }, { status: 400 })
    }
    if (!Array.isArray(body.planIds) || body.planIds.length === 0) {
      return NextResponse.json({ error: 'planIds[] requis (non vide)' }, { status: 400 })
    }

    // Vérification : tous les planIds doivent appartenir à la section.
    // Évite qu'un appel mal formé n'écrive sort_order sur des plans d'une autre
    // section.
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('plans')
      .select('id')
      .eq('section_id', body.sectionId)
      .in('id', body.planIds)
    if (fetchErr) throw fetchErr
    const existingIds = new Set((existing ?? []).map(r => r.id))
    const invalid = body.planIds.filter(id => !existingIds.has(id))
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `planIds inconnus dans cette section : ${invalid.join(', ')}` },
        { status: 400 },
      )
    }

    // Update en parallèle (plus rapide que séquentiel pour N petit).
    const updates = body.planIds.map((id, idx) =>
      supabaseAdmin.from('plans').update({ sort_order: idx }).eq('id', id),
    )
    const results = await Promise.all(updates)
    const failed = results.find(r => r.error)
    if (failed?.error) throw failed.error

    return NextResponse.json({ success: true, count: body.planIds.length })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/plans/reorder POST]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
