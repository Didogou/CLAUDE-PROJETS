/**
 * /api/pellicules/[id]/layers — CRUD calques runtime d'une pellicule.
 *
 * `[id]` = section_timeline.id (= la pellicule à laquelle les calques sont
 * attachés). Migration 088 (2026-05-18) — Phase A keyframes chantier.
 *
 * GET    → liste les calques de cette pellicule, ordonnés par z_index ASC.
 * POST   body = { type, media_url?, position_x?, position_y?, scale?, rotation?,
 *                 opacity?, blend?, z_index?, visible?, mask?, effects?, params? }
 *        → crée 1 calque. Defaults appliqués si champs omis.
 *        → si z_index omis, auto-incrément (max existant + 1).
 * PATCH  body = { layers: [{ id, ...props }, ...] }
 *        → bulk update (utilisé pour reorder z_index en 1 transaction).
 * DELETE ?layerId=X
 *        → retire 1 calque.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  PELLICULE_LAYER_DEFAULTS,
  type PelliculeLayerCreate,
  type PelliculeLayerPatch,
} from '@/lib/pellicule-layers-types'

export const runtime = 'nodejs'

const ALLOWED_TYPES = ['image', 'video', 'gif'] as const

// ── GET ─────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: pelliculeId } = await params
    const { data: layers, error } = await supabaseAdmin
      .from('pellicule_layers')
      .select('*')
      .eq('pellicule_id', pelliculeId)
      .order('z_index', { ascending: true })
    if (error) throw error
    return NextResponse.json({ layers: layers ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/pellicules/[id]/layers GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── POST (création) ─────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: pelliculeId } = await params
    const body = (await req.json()) as PelliculeLayerCreate

    // Validations bornes
    if (!body.type || !ALLOWED_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: `type requis et doit être un de ${ALLOWED_TYPES.join('|')}` },
        { status: 400 },
      )
    }
    // Pour les types V1 (image/video/gif), media_url est obligatoire — sinon
    // le calque serait une row fantôme invisible au runtime. Les types futurs
    // (weather, composition) pourront accepter media_url null + utiliser params.
    if (!body.media_url || typeof body.media_url !== 'string') {
      return NextResponse.json(
        { error: 'media_url requis (string) pour les types image/video/gif' },
        { status: 400 },
      )
    }
    // Vérifie pellicule existe (= la row section_timeline référencée)
    const { data: pellicule } = await supabaseAdmin
      .from('section_timeline')
      .select('id')
      .eq('id', pelliculeId)
      .maybeSingle()
    if (!pellicule) {
      return NextResponse.json({ error: 'pellicule introuvable' }, { status: 404 })
    }

    // Auto-z_index = max existant + 1 si non fourni
    let zIndex = body.z_index
    if (zIndex == null) {
      const { data: top } = await supabaseAdmin
        .from('pellicule_layers')
        .select('z_index')
        .eq('pellicule_id', pelliculeId)
        .order('z_index', { ascending: false })
        .limit(1)
        .maybeSingle()
      zIndex = (top?.z_index ?? -1) + 1
    }

    const insert = {
      pellicule_id: pelliculeId,
      type: body.type,
      media_url: body.media_url ?? null,
      position_x: body.position_x ?? PELLICULE_LAYER_DEFAULTS.position_x,
      position_y: body.position_y ?? PELLICULE_LAYER_DEFAULTS.position_y,
      scale: body.scale ?? PELLICULE_LAYER_DEFAULTS.scale,
      rotation: body.rotation ?? PELLICULE_LAYER_DEFAULTS.rotation,
      opacity: body.opacity ?? PELLICULE_LAYER_DEFAULTS.opacity,
      blend: body.blend ?? PELLICULE_LAYER_DEFAULTS.blend,
      z_index: zIndex,
      visible: body.visible ?? PELLICULE_LAYER_DEFAULTS.visible,
      mask: body.mask ?? null,
      effects: body.effects ?? null,
      params: body.params ?? null,
      // Phase A bis 2026-05-18 — timing in/out
      start_ms_rel: body.start_ms_rel ?? PELLICULE_LAYER_DEFAULTS.start_ms_rel,
      duration_ms: body.duration_ms ?? PELLICULE_LAYER_DEFAULTS.duration_ms,
    }

    const { data: layer, error: insertErr } = await supabaseAdmin
      .from('pellicule_layers')
      .insert(insert)
      .select('*')
      .single()
    if (insertErr) throw insertErr

    return NextResponse.json({ layer })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/pellicules/[id]/layers POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── PATCH (bulk update) ─────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: pelliculeId } = await params
    const body = (await req.json()) as {
      layers?: Array<{ id: string } & PelliculeLayerPatch>
    }
    const layers = body.layers ?? []
    if (layers.length === 0) {
      return NextResponse.json({ updated: 0 })
    }

    // PATCH par row (Supabase ne supporte pas le bulk différencié).
    // Logique de logs identique au PATCH timeline pour faciliter le debug client.
    let updated = 0
    const errors: Array<{ id: string; error: string }> = []
    for (const l of layers) {
      const patch: Record<string, unknown> = {}
      // Whitelist explicite : on n'autorise PAS de patch sur id / pellicule_id /
      // created_at / updated_at (trigger DB gère ce dernier). Le `type` est aussi
      // exclu : changer le type d'un calque existant créerait un mismatch avec
      // media_url (ex: image PNG type='video' → <video> reçoit une image). Si
      // l'auteur veut changer de type, il supprime + recrée.
      const allowedKeys = [
        'media_url',
        'position_x', 'position_y', 'scale', 'rotation', 'opacity',
        'blend', 'z_index', 'visible',
        'mask', 'effects', 'params',
        // Phase A bis 2026-05-18 — timing in/out
        'start_ms_rel', 'duration_ms',
      ] as const
      for (const k of allowedKeys) {
        const v = (l as Record<string, unknown>)[k]
        if (v !== undefined) patch[k] = v
      }
      if (Object.keys(patch).length === 0) continue

      const { error } = await supabaseAdmin
        .from('pellicule_layers')
        .update(patch)
        .eq('id', l.id)
        .eq('pellicule_id', pelliculeId)  // scope guard
      if (error) {
        errors.push({ id: l.id, error: error.message })
        console.error('[PATCH layers] update failed', l.id, error)
      } else {
        updated++
      }
    }
    return NextResponse.json({
      updated,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/pellicules/[id]/layers PATCH]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── DELETE (1 calque par layerId) ───────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: pelliculeId } = await params
    const layerId = req.nextUrl.searchParams.get('layerId')
    if (!layerId) {
      return NextResponse.json({ error: 'layerId requis' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('pellicule_layers')
      .delete()
      .eq('id', layerId)
      .eq('pellicule_id', pelliculeId)  // scope guard
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/pellicules/[id]/layers DELETE]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
