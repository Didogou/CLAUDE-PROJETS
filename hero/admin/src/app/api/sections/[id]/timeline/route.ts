/**
 * /api/sections/[id]/timeline — CRUD timeline V2 (refonte 2026-05-13)
 *
 * GET    → liste les blocs section_timeline + JOIN avec assets pour récupérer
 *         leurs détails (url, label, durée). Ordre par position_idx ASC.
 *
 * POST   body = { track, asset_type, asset_id, start_ms, duration_ms, position_idx?, overrides? }
 *        → ajoute un bloc à la fin de la timeline (position_idx auto si absent).
 *        → garantit asset_usage existe (= si l'auteur drop un asset d'un autre
 *          livre, on crée la ref usage à la volée).
 *
 * PATCH  body = { blocks: [{ id, position_idx?, start_ms?, duration_ms?, overrides? }, ...] }
 *        → bulk update — utilisé pour reorder ou move blocs en 1 transaction.
 *
 * DELETE ?blockId=X
 *        → retire 1 bloc. L'asset reste dans sa banque + usage_row reste (autres
 *          sections peuvent encore le référencer). Cleanup orphan asset_usage
 *          fait par job nightly séparé.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

const TABLE_BY_TYPE: Record<string, string> = {
  image: 'assets_image',
  animation: 'assets_animation',
  audio: 'assets_audio',
  text: 'assets_text',
}

// ── GET ─────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sectionId } = await params

    // Fetch tous les blocs de la timeline (ordre position_idx)
    const { data: blocks, error: blocksErr } = await supabaseAdmin
      .from('section_timeline')
      .select('*')
      .eq('section_id', sectionId)
      .order('position_idx', { ascending: true })
    if (blocksErr) throw blocksErr

    // JOIN manuel : groupe les asset_id par type et fetch en bulk
    const idsByType: Record<string, string[]> = {}
    for (const b of blocks ?? []) {
      idsByType[b.asset_type] = idsByType[b.asset_type] ?? []
      idsByType[b.asset_type].push(b.asset_id)
    }
    const assetsByTypeAndId: Record<string, Record<string, unknown>> = {}
    for (const [type, ids] of Object.entries(idsByType)) {
      const tbl = TABLE_BY_TYPE[type]
      if (!tbl) continue
      const { data: assets } = await supabaseAdmin
        .from(tbl)
        .select('*')
        .in('id', ids)
      assetsByTypeAndId[type] = {}
      for (const a of assets ?? []) {
        ;(assetsByTypeAndId[type] as Record<string, unknown>)[(a as { id: string }).id] = a
      }
    }

    // Hydrate chaque bloc avec son asset
    const enriched = (blocks ?? []).map(b => ({
      ...b,
      asset: (assetsByTypeAndId[b.asset_type] as Record<string, unknown> | undefined)?.[b.asset_id] ?? null,
    }))

    return NextResponse.json({ blocks: enriched })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/sections/[id]/timeline GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── POST (ajout bloc) ───────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sectionId } = await params
    const body = await req.json() as {
      track?: string
      asset_type?: string
      asset_id?: string
      start_ms?: number
      duration_ms?: number
      position_idx?: number
      overrides?: unknown
    }
    if (!body.track || !body.asset_type || !body.asset_id) {
      return NextResponse.json({ error: 'track + asset_type + asset_id requis' }, { status: 400 })
    }

    // Récupère book_id de la section pour garantir asset_usage
    const { data: section } = await supabaseAdmin
      .from('sections')
      .select('book_id')
      .eq('id', sectionId)
      .single()
    if (!section) {
      return NextResponse.json({ error: 'section introuvable' }, { status: 404 })
    }

    // Garantit asset_usage (ON CONFLICT DO NOTHING via le UNIQUE constraint)
    await supabaseAdmin.from('asset_usage').upsert({
      asset_type: body.asset_type,
      asset_id: body.asset_id,
      book_id: section.book_id,
      section_id: sectionId,
    }, { onConflict: 'asset_type,asset_id,book_id,section_id', ignoreDuplicates: true })

    // Calcule position_idx si non fourni : end of timeline
    let positionIdx = body.position_idx
    if (positionIdx == null) {
      const { data: lastBlock } = await supabaseAdmin
        .from('section_timeline')
        .select('position_idx')
        .eq('section_id', sectionId)
        .order('position_idx', { ascending: false })
        .limit(1)
        .maybeSingle()
      positionIdx = (lastBlock?.position_idx ?? -1) + 1
    }

    // Phase 1a + 3a (refonte 2026-05-14y) : auto-snap start_ms à la fin du
    // dernier bloc de la même track si non fourni. Garantit qu'un bloc
    // ajouté sur timeline vide commence à 0s, et qu'un drop suivant
    // s'enchaîne pile à la fin du précédent (pas de chevauchement).
    let startMs = body.start_ms
    if (startMs == null) {
      const { data: lastTrackBlock } = await supabaseAdmin
        .from('section_timeline')
        .select('start_ms, duration_ms')
        .eq('section_id', sectionId)
        .eq('track', body.track)
        .order('start_ms', { ascending: false })
        .limit(1)
        .maybeSingle()
      startMs = lastTrackBlock
        ? (lastTrackBlock.start_ms + lastTrackBlock.duration_ms)
        : 0
    }

    const { data: block, error: insertErr } = await supabaseAdmin
      .from('section_timeline')
      .insert({
        section_id: sectionId,
        position_idx: positionIdx,
        track: body.track,
        asset_type: body.asset_type,
        asset_id: body.asset_id,
        start_ms: startMs,
        duration_ms: body.duration_ms ?? 3000,
        overrides: body.overrides ?? null,
      })
      .select('*')
      .single()
    if (insertErr) throw insertErr

    return NextResponse.json({ block })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/sections/[id]/timeline POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── PATCH (bulk update / reorder) ───────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sectionId } = await params
    const body = await req.json() as {
      blocks?: Array<{
        id: string
        position_idx?: number
        start_ms?: number
        duration_ms?: number
        overrides?: unknown
        // Phase B keyframes 2026-05-18 — animation pellicule (migration 089)
        keyframes?: unknown
      }>
    }
    const blocks = body.blocks ?? []
    if (blocks.length === 0) {
      return NextResponse.json({ updated: 0 })
    }

    // Update chaque bloc individuellement (Supabase ne supporte pas bulk
    // PATCH différencié sans rpc). Pour V1 on accepte N requêtes — si perf
    // critique, créer une RPC stored proc.
    // Refonte 2026-05-17 — log les erreurs individuelles pour debug client
    // (avant : erreurs UNIQUE constraint silencieusement avalées).
    let updated = 0
    const errors: Array<{ id: string; error: string }> = []
    for (const b of blocks) {
      const patch: Record<string, unknown> = {}
      if (b.position_idx != null) patch.position_idx = b.position_idx
      if (b.start_ms != null) patch.start_ms = b.start_ms
      if (b.duration_ms != null) patch.duration_ms = b.duration_ms
      if (b.overrides !== undefined) patch.overrides = b.overrides
      if (b.keyframes !== undefined) patch.keyframes = b.keyframes
      if (Object.keys(patch).length === 0) continue
      const { error } = await supabaseAdmin
        .from('section_timeline')
        .update(patch)
        .eq('id', b.id)
        .eq('section_id', sectionId)
      if (error) {
        errors.push({ id: b.id, error: error.message })
        console.error('[PATCH timeline] update failed', b.id, error)
      } else {
        updated++
      }
    }
    return NextResponse.json({ updated, errors: errors.length > 0 ? errors : undefined })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/sections/[id]/timeline PATCH]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── DELETE (retire 1 bloc OU tous les blocs d'un asset) ────────────────
//
// 2 modes (mutuellement exclusifs) :
//   - ?blockId=X                    → retire le bloc précis (single)
//   - ?assetType=X&assetId=Y        → retire TOUS les blocs de cette section
//                                     qui pointent vers cet asset (= cas
//                                     "croix sur la timeline" depuis le
//                                     AnimationStudio où on a juste l'assetId
//                                     en main, pas le blockId).

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sectionId } = await params
    const blockId = req.nextUrl.searchParams.get('blockId')
    const assetType = req.nextUrl.searchParams.get('assetType')
    const assetId = req.nextUrl.searchParams.get('assetId')

    if (blockId) {
      const { error } = await supabaseAdmin
        .from('section_timeline')
        .delete()
        .eq('id', blockId)
        .eq('section_id', sectionId)
      if (error) throw error
      return NextResponse.json({ ok: true, mode: 'single' })
    }

    if (assetType && assetId) {
      const { data, error } = await supabaseAdmin
        .from('section_timeline')
        .delete()
        .eq('section_id', sectionId)
        .eq('asset_type', assetType)
        .eq('asset_id', assetId)
        .select('id')
      if (error) throw error
      return NextResponse.json({ ok: true, mode: 'by_asset', deleted: data?.length ?? 0 })
    }

    return NextResponse.json(
      { error: 'blockId OU (assetType + assetId) requis' },
      { status: 400 },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/sections/[id]/timeline DELETE]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
