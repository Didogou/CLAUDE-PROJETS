/**
 * /api/assets/[type] — CRUD banque d'assets V2 (refonte 2026-05-13)
 *
 * type ∈ { image, animation, audio, text }
 *
 * GET   ?bookId=X[&sectionId=Y][&search=Z]
 *       → liste les assets visibles dans le scope (filtrés via asset_usage)
 *       Joint asset_usage pour ne retourner que ceux référencés dans bookId
 *       (et optionnellement sectionId).
 *
 * POST  body = { ...asset_fields, bookId, sectionId? }
 *       → crée l'asset + 1 row asset_usage. Retourne { asset, usage_id }.
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

/** Whitelist des colonnes admissibles au POST (#3 audit V2 : sécurise contre
 *  injection de id/created_at/updated_at par client malveillant + force
 *  validation des champs NOT NULL avant DB pour erreur HTTP 400 claire). */
const ALLOWED_FIELDS_BY_TYPE: Record<AssetType, string[]> = {
  image: ['id', 'url', 'label', 'description', 'prompt_fr', 'prompt_en', 'style',
          'width', 'height', 'comfyui_settings', 'source_type', 'layers'],
  animation: ['id', 'video_url', 'first_frame_url', 'last_frame_url', 'label',
              'scene_visible', 'scene_offscreen', 'characters_appearance',
              'character_ids', 'shots', 'trim_start', 'trim_end', 'source',
              'v2v_continue', 'exit_data', 'type', 'audio_tracks',
              'effects_params'],  // refonte 2026-05-15bp — WebGL color grading
  audio: ['id', 'audio_url', 'kind', 'label', 'duration_sec', 'source_type'],
  text: ['id', 'text', 'template', 'position', 'size', 'default_duration_sec'],
}
// Validation UUID v4 pour le client-supplied id (lazy-create draft → commit).
// Si fourni : doit être un UUID valide pour éviter abus / collision triviale.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REQUIRED_FIELDS_BY_TYPE: Record<AssetType, string[]> = {
  image: ['url'],
  animation: [],  // tout optional (drafts autorisés)
  audio: ['audio_url', 'kind'],
  text: ['text'],
}

function validateType(t: string): t is AssetType {
  return (VALID_TYPES as readonly string[]).includes(t)
}

function pickAllowed(body: Record<string, unknown>, type: AssetType) {
  const out: Record<string, unknown> = {}
  for (const key of ALLOWED_FIELDS_BY_TYPE[type]) {
    if (key in body) out[key] = body[key]
  }
  return out
}

// ── GET ─────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  try {
    const { type } = await params
    if (!validateType(type)) {
      return NextResponse.json({ error: `type invalide (attendu: ${VALID_TYPES.join('|')})` }, { status: 400 })
    }
    const bookId = req.nextUrl.searchParams.get('bookId')
    const sectionId = req.nextUrl.searchParams.get('sectionId')
    const search = req.nextUrl.searchParams.get('search')
    if (!bookId) {
      return NextResponse.json({ error: 'bookId requis' }, { status: 400 })
    }

    // Fetch asset_usage rows pour ce livre (+ section si fournie).
    // Refonte 2026-05-14bd : on inclut section_id dans la projection pour
    // permettre au client de grouper les assets par section (banque V2 du
    // Studio Animation). Backward-compat : `assets` toujours retourné.
    let usageQuery = supabaseAdmin
      .from('asset_usage')
      .select('asset_id, section_id')
      .eq('asset_type', type)
      .eq('book_id', bookId)
    if (sectionId) usageQuery = usageQuery.eq('section_id', sectionId)
    const { data: usages, error: usageErr } = await usageQuery
    if (usageErr) throw usageErr
    const assetIds = Array.from(new Set((usages ?? []).map(u => u.asset_id)))
    if (assetIds.length === 0) {
      return NextResponse.json({ assets: [], usages: [] })
    }

    // Fetch les assets correspondants
    let assetQuery = supabaseAdmin
      .from(TABLE_BY_TYPE[type])
      .select('*')
      .in('id', assetIds)
    // Search optionnel sur label (textuel)
    if (search) {
      assetQuery = assetQuery.ilike('label', `%${search}%`)
    }
    const { data: assets, error: assetErr } = await assetQuery
      .order('created_at', { ascending: false })
    if (assetErr) throw assetErr

    return NextResponse.json({ assets, usages: usages ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/assets/[type] GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── POST ────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  try {
    const { type } = await params
    if (!validateType(type)) {
      return NextResponse.json({ error: `type invalide` }, { status: 400 })
    }
    const body = await req.json() as Record<string, unknown> & {
      bookId?: string
      sectionId?: string
    }
    const bookId = body.bookId
    const sectionId = body.sectionId ?? null
    if (!bookId) {
      return NextResponse.json({ error: 'bookId requis' }, { status: 400 })
    }

    // #3 audit V2 : whitelist par type — strip toute colonne inadmissible
    // (incluant created_at, updated_at, sectionId, bookId). `id` est désormais
    // autorisé pour permettre le lazy-create draft → commit avec UUID stable.
    const assetFields = pickAllowed(body, type)
    if (assetFields.id !== undefined) {
      if (typeof assetFields.id !== 'string' || !UUID_RE.test(assetFields.id)) {
        return NextResponse.json({ error: 'id doit être un UUID v4 valide' }, { status: 400 })
      }
    }
    // Validation champs NOT NULL avant DB pour erreur claire 400
    for (const req of REQUIRED_FIELDS_BY_TYPE[type]) {
      if (assetFields[req] === undefined || assetFields[req] === null) {
        return NextResponse.json(
          { error: `champ '${req}' requis pour asset type='${type}'` },
          { status: 400 },
        )
      }
    }

    // INSERT asset
    const { data: asset, error: assetErr } = await supabaseAdmin
      .from(TABLE_BY_TYPE[type])
      .insert(assetFields)
      .select('*')
      .single()
    if (assetErr) throw assetErr

    // INSERT asset_usage
    const { data: usage, error: usageErr } = await supabaseAdmin
      .from('asset_usage')
      .insert({
        asset_type: type,
        asset_id: asset.id,
        book_id: bookId,
        section_id: sectionId,
      })
      .select('id')
      .single()
    if (usageErr) {
      // Rollback : delete l'asset créé
      await supabaseAdmin.from(TABLE_BY_TYPE[type]).delete().eq('id', asset.id)
      throw usageErr
    }

    return NextResponse.json({ asset, usage_id: usage.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/assets/[type] POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
