import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * /api/plans
 *
 * Endpoints sur la table `plans` (Plans = entités du storyboard de Section,
 * cf migration 075_plans.sql). Distincts du legacy `/api/sections/[id]/plans`
 * (qui opère sur sections.images[]) — ne pas confondre.
 */

// ──────────────────────────────────────────────────────────────────────────
// GET /api/plans?sectionId=X[&type=static][&hydrate=1]
//   Liste les Plans d'une section (ordonnés par sort_order).
// GET /api/plans?bookId=X[&type=conversation]
//   Liste les Plans d'un livre entier (utile pour stats / banques).
//
// Si hydrate=1 (ou requête niveau section) : on join npcs + items et on
// renvoie characters[] / items[] (avec portrait_url / illustration_url) en
// plus des `npc_ids` / `item_ids` bruts. Évite N+1 fetches côté UI Storyboard.
// ──────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const sectionId = sp.get('sectionId')
    const bookId = sp.get('bookId')
    const type = sp.get('type')
    const hydrate = sp.get('hydrate') === '1' || !!sectionId  // hydrate auto en mode section

    if (!sectionId && !bookId) {
      return NextResponse.json(
        { error: 'sectionId ou bookId requis' },
        { status: 400 },
      )
    }

    let query = supabaseAdmin.from('plans').select('*').order('sort_order')
    if (sectionId) query = query.eq('section_id', sectionId)
    if (bookId)    query = query.eq('book_id', bookId)
    if (type)      query = query.eq('type', type)

    const { data: plans, error } = await query
    if (error) throw error
    const rows = plans ?? []

    if (!hydrate || rows.length === 0) {
      return NextResponse.json(rows)
    }

    // Hydratation : 1 fetch par table (pas de N+1) sur l'union de tous les
    // npc_ids et item_ids des plans → puis on remappe dans chaque row.
    const allNpcIds = Array.from(new Set(
      rows.flatMap(r => (r.npc_ids as string[] | null) ?? []),
    ))
    const allItemIds = Array.from(new Set(
      rows.flatMap(r => (r.item_ids as string[] | null) ?? []),
    ))

    const [{ data: npcs }, { data: items }] = await Promise.all([
      allNpcIds.length > 0
        ? supabaseAdmin.from('npcs').select('id, name, portrait_url').in('id', allNpcIds)
        : Promise.resolve({ data: [] as { id: string; name: string; portrait_url: string | null }[] }),
      allItemIds.length > 0
        ? supabaseAdmin.from('items').select('id, name, illustration_url').in('id', allItemIds)
        : Promise.resolve({ data: [] as { id: string; name: string; illustration_url: string | null }[] }),
    ])

    const npcById = new Map((npcs ?? []).map(n => [n.id, n]))
    const itemById = new Map((items ?? []).map(i => [i.id, i]))

    const hydrated = rows.map(r => ({
      ...r,
      // characters[] / items[] reconstruits dans l'ordre des refs (UI peut s'y fier)
      characters: ((r.npc_ids as string[] | null) ?? [])
        .map(id => npcById.get(id))
        .filter(Boolean)
        .map(n => ({ id: n!.id, name: n!.name, portraitUrl: n!.portrait_url })),
      items: ((r.item_ids as string[] | null) ?? [])
        .map(id => itemById.get(id))
        .filter(Boolean)
        .map(i => ({ id: i!.id, name: i!.name, iconUrl: i!.illustration_url })),
    }))

    return NextResponse.json(hydrated)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/plans GET]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/plans
//   Crée un nouveau Plan dans la section. sort_order auto-calculé (max+1).
//
//   Body : { sectionId: string, type?: 'static'|'animation'|'conversation',
//            title?: string, data?: object }
//   Default type = 'static'. Default data = {}.
// ──────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sectionId?: string
      type?: 'static' | 'animation' | 'conversation' | 'choice'
      title?: string | null
      data?: Record<string, unknown>
    }

    if (!body.sectionId) {
      return NextResponse.json({ error: 'sectionId requis' }, { status: 400 })
    }

    // Récupère le book_id de la section (FK redondante en BDD pour query speed)
    const { data: section, error: secErr } = await supabaseAdmin
      .from('sections')
      .select('id, book_id')
      .eq('id', body.sectionId)
      .single()
    if (secErr || !section) {
      return NextResponse.json({ error: 'section introuvable' }, { status: 404 })
    }

    // Calcule sort_order = max+1 dans la section
    const { data: maxRow } = await supabaseAdmin
      .from('plans')
      .select('sort_order')
      .eq('section_id', body.sectionId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextOrder = (maxRow?.sort_order ?? -1) + 1

    const { data: created, error: insErr } = await supabaseAdmin
      .from('plans')
      .insert({
        book_id: section.book_id,
        section_id: body.sectionId,
        sort_order: nextOrder,
        type: body.type ?? 'static',
        title: body.title ?? null,
        data: body.data ?? {},
      })
      .select()
      .single()

    if (insErr) throw insErr
    return NextResponse.json(created)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/plans POST]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
