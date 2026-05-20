import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/books/[id]/all-plans
 *
 * Renvoie tous les plans de toutes les sections du livre, ordonnés par
 *   sections.number ASC, plans.sort_order ASC
 *
 * Utilisé par le StickyPreviewPanel du Studio Section pour le mode "preview
 * total" qui chaîne les vidéos des pellicules de toutes les sections.
 *
 * Pas d'hydratation characters/items (contrairement à /api/plans?sectionId=X) —
 * le preview n'en a pas besoin, on évite de charger N rows pour un livre de
 * 50+ sections.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: bookId } = await params

    // 1. Sections du livre (pour ordonner par number et enrichir les plans).
    // Schéma sections : `number` (int) + `summary` (text, peut servir de titre).
    const { data: sections, error: secErr } = await supabaseAdmin
      .from('sections')
      .select('id, number, summary')
      .eq('book_id', bookId)
      .order('number')
    if (secErr) throw secErr

    if (!sections || sections.length === 0) {
      return NextResponse.json([])
    }
    const sectionById = new Map(sections.map(s => [s.id, s]))

    // 2. Plans du livre (un seul appel — pas de hit N+1)
    const { data: plans, error: planErr } = await supabaseAdmin
      .from('plans')
      .select('*')
      .eq('book_id', bookId)
      .order('sort_order')
    if (planErr) throw planErr

    // 3. Enrichi + tri global (section.number puis sort_order). On expose
    //    section_title = summary de la section (pratique pour l'auteur dans
    //    le compteur "S2 — Salons modernes").
    const enriched = (plans ?? [])
      .map(p => {
        const section = sectionById.get(p.section_id as string)
        return {
          ...p,
          section_number: section?.number ?? 999_999,
          section_title: section?.summary ?? '',
        }
      })
      .sort((a, b) =>
        a.section_number - b.section_number || a.sort_order - b.sort_order,
      )

    return NextResponse.json(enriched)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/books/[id]/all-plans GET]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
