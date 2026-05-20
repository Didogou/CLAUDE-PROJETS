import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * /api/plans/[id]
 *
 * CRUD sur 1 Plan (table `plans`, cf migration 075_plans.sql).
 */

// ──────────────────────────────────────────────────────────────────────────
// GET /api/plans/[id]
//   Récupère 1 Plan par id, avec hydratation des refs npc_ids/item_ids
//   (characters[]/items[] avec portrait_url/illustration_url).
//   Utile pour Studio Designer (édition d'1 Plan).
// ──────────────────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { data: plan, error } = await supabaseAdmin
      .from('plans')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !plan) {
      return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 })
    }

    const npcIds = (plan.npc_ids as string[] | null) ?? []
    const itemIds = (plan.item_ids as string[] | null) ?? []

    const [{ data: npcs }, { data: items }] = await Promise.all([
      npcIds.length > 0
        ? supabaseAdmin.from('npcs').select('id, name, portrait_url').in('id', npcIds)
        : Promise.resolve({ data: [] as { id: string; name: string; portrait_url: string | null }[] }),
      itemIds.length > 0
        ? supabaseAdmin.from('items').select('id, name, illustration_url').in('id', itemIds)
        : Promise.resolve({ data: [] as { id: string; name: string; illustration_url: string | null }[] }),
    ])

    const npcById = new Map((npcs ?? []).map(n => [n.id, n]))
    const itemById = new Map((items ?? []).map(i => [i.id, i]))

    return NextResponse.json({
      ...plan,
      characters: npcIds.map(nid => npcById.get(nid)).filter(Boolean)
        .map(n => ({ id: n!.id, name: n!.name, portraitUrl: n!.portrait_url })),
      items: itemIds.map(iid => itemById.get(iid)).filter(Boolean)
        .map(i => ({ id: i!.id, name: i!.name, iconUrl: i!.illustration_url })),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/plans/[id] GET]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PATCH /api/plans/[id]
//   Update partiel d'1 Plan. Allowlist : title, type, data, sort_order,
//   summary, npc_ids, item_ids.
//   `book_id` et `section_id` sont volontairement immutables (pas de move
//   entre sections via PATCH — utiliser DELETE+POST si besoin).
//
//   Body : { title?, type?, data?, sort_order?, summary?, npc_ids?, item_ids? }
// ──────────────────────────────────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json() as {
      title?: string | null
      type?: 'static' | 'animation' | 'conversation' | 'choice'
      data?: Record<string, unknown>
      sort_order?: number
      summary?: string | null
      npc_ids?: string[]
      item_ids?: string[]
    }

    const allowed: Record<string, unknown> = {}
    if ('title' in body)      allowed.title = body.title
    if ('type' in body) {
      if (!['static', 'animation', 'conversation', 'choice'].includes(body.type as string)) {
        return NextResponse.json({ error: `type invalide : ${body.type}` }, { status: 400 })
      }
      allowed.type = body.type
    }
    if ('data' in body)       allowed.data = body.data
    if ('sort_order' in body) allowed.sort_order = body.sort_order
    if ('summary' in body)    allowed.summary = body.summary
    if ('npc_ids' in body) {
      if (!Array.isArray(body.npc_ids)) {
        return NextResponse.json({ error: 'npc_ids doit être un array' }, { status: 400 })
      }
      allowed.npc_ids = body.npc_ids
    }
    if ('item_ids' in body) {
      if (!Array.isArray(body.item_ids)) {
        return NextResponse.json({ error: 'item_ids doit être un array' }, { status: 400 })
      }
      allowed.item_ids = body.item_ids
    }

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ error: 'aucun champ à update' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('plans')
      .update(allowed)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      // PostgrestError n'est pas un Error standard côté Supabase JS — il a
      // message/details/hint/code mais n'extends pas Error. Log + sérialise
      // proprement pour pas renvoyer "[object Object]" au client (fix 2026-05-12).
      console.error('[/api/plans/[id] PATCH] Supabase:', error)
      const msg = error.message
        || error.details
        || error.hint
        || `Supabase code ${error.code ?? 'unknown'}`
      return NextResponse.json({ error: msg, code: error.code }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (typeof err === 'object' && err !== null
        ? JSON.stringify(err)
        : String(err))
    console.error('[/api/plans/[id] PATCH]', message, err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/plans/[id]
//   Supprime 1 Plan. NE re-compacte PAS les sort_order des plans suivants
//   (V0 : laisse trous, l'UI reorder via PATCH /reorder si besoin).
// ──────────────────────────────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { error } = await supabaseAdmin
      .from('plans')
      .delete()
      .eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/plans/[id] DELETE]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
