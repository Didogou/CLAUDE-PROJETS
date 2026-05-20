/**
 * /api/assets/[type]/[id] — PATCH + DELETE 1 asset (refonte 2026-05-13)
 *
 * type ∈ { image, animation, audio, text }
 *
 * PATCH body = { ...fields_to_update }
 *       → update partiel l'asset. updated_at géré par trigger DB.
 *
 * DELETE
 *       → supprime l'asset. CASCADE : asset_usage rows supprimés via leur FK
 *         (mais asset_usage n'a pas de FK vers assets_<type>, juste asset_type
 *         + asset_id en logical FK). Donc on cleanup manuellement les rows
 *         asset_usage AVANT, puis section_timeline qui pointent vers cet asset.
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

/** Whitelist des colonnes admissibles au PATCH par type d'asset.
 *  Refonte 2026-05-15cx — sans whitelist, un champ inconnu côté client (ex:
 *  legacy field `preset` qui n'existe pas en DB) causait un 500 Postgres
 *  "column does not exist" sur l'autosave, polluant les logs.
 *  Aligné avec la whitelist POST de /api/assets/[type]. */
const ALLOWED_FIELDS_BY_TYPE: Record<AssetType, string[]> = {
  image: ['url', 'label', 'description', 'prompt_fr', 'prompt_en', 'style',
          'width', 'height', 'comfyui_settings', 'source_type', 'layers'],
  animation: ['video_url', 'first_frame_url', 'last_frame_url', 'label',
              'scene_visible', 'scene_offscreen', 'characters_appearance',
              'character_ids', 'shots', 'trim_start', 'trim_end', 'source',
              'v2v_continue', 'exit_data', 'type', 'audio_tracks',
              'effects_params'],
  audio: ['audio_url', 'kind', 'label', 'duration_sec', 'source_type'],
  text: ['text', 'template', 'position', 'size', 'default_duration_sec'],
}

function validateType(t: string): t is AssetType {
  return (VALID_TYPES as readonly string[]).includes(t)
}

// ── GET (single asset) ──────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  try {
    const { type, id } = await params
    if (!validateType(type)) {
      return NextResponse.json({ error: 'type invalide' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin
      .from(TABLE_BY_TYPE[type])
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) {
      // PGRST116 = no row found → on retourne 404 propre (pas 500)
      const code = (error as { code?: string }).code
      if (code === 'PGRST116') {
        return NextResponse.json({ error: 'asset introuvable' }, { status: 404 })
      }
      throw error
    }
    if (!data) return NextResponse.json({ error: 'asset introuvable' }, { status: 404 })
    return NextResponse.json({ asset: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── PATCH ───────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  try {
    const { type, id } = await params
    if (!validateType(type)) {
      return NextResponse.json({ error: 'type invalide' }, { status: 400 })
    }
    const body = await req.json() as Record<string, unknown>
    // Sécurité : strip id, created_at, updated_at (= colonnes immuables)
    delete body.id
    delete body.created_at
    delete body.updated_at

    // Refonte 2026-05-15cx — whitelist des champs admissibles. Évite les 500
    // Postgres "column does not exist" si le client envoie un champ legacy /
    // inattendu. Si plus rien à update après whitelist → no-op silent.
    const allowed = ALLOWED_FIELDS_BY_TYPE[type]
    const filtered: Record<string, unknown> = {}
    for (const k of allowed) {
      if (k in body) filtered[k] = body[k]
    }
    if (Object.keys(filtered).length === 0) {
      return NextResponse.json({ asset: null, updated: false, reason: 'no allowed fields' })
    }

    // `.maybeSingle()` au lieu de `.single()` pour ne PAS lever PGRST116 (500)
    // quand l'asset est un draft pas encore committé en DB (lazy-create pattern).
    const { data, error } = await supabaseAdmin
      .from(TABLE_BY_TYPE[type])
      .update(filtered)
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) throw error

    if (!data) {
      // Row inexistante (draft pas encore committé). Réponse OK silencieuse.
      return NextResponse.json({ asset: null, updated: false })
    }

    return NextResponse.json({ asset: data, updated: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Refonte 2026-05-15db — log + return détaillé pour debug client
    const detail = err && typeof err === 'object'
      ? { message: msg, code: (err as { code?: string }).code, details: (err as { details?: string }).details, hint: (err as { hint?: string }).hint }
      : { message: msg }
    console.error('[/api/assets/[type]/[id] PATCH]', detail)
    return NextResponse.json({ error: msg, ...detail }, { status: 500 })
  }
}

// ── DELETE ──────────────────────────────────────────────────────────────
//
// Refonte V3 (2026-05-13) : utilise les RPC plpgsql `delete_asset_scoped` /
// `delete_asset_global` (migration 084) au lieu de 3 requêtes Supabase JS
// séparées → exécution atomique côté DB, plus de partial-fail possible.
//
// Sémantique :
//   - Sans `?bookId=...`  → cascade GLOBALE (tous les livres). Réservé aux
//     opérations admin / cleanup. Dangereux si l'asset est partagé.
//   - Avec `?bookId=...`  → SCOPED : retire l'asset du livre courant
//     uniquement. L'asset row n'est libéré que si plus aucune ref restante
//     dans aucun autre livre (= comportement attendu du bouton corbeille
//     library Studio Section). Audit V2 HAUTE : "DELETE scopé bookId".

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  try {
    const { type, id } = await params
    if (!validateType(type)) {
      return NextResponse.json({ error: 'type invalide' }, { status: 400 })
    }
    const bookId = req.nextUrl.searchParams.get('bookId')

    if (bookId) {
      // ── Mode SCOPED : retire l'asset de CE livre uniquement ─────────
      const { data, error } = await supabaseAdmin.rpc('delete_asset_scoped', {
        p_asset_type: type,
        p_asset_id: id,
        p_book_id: bookId,
      })
      if (error) throw error
      return NextResponse.json({ ok: true, ...(data as object) })
    }

    // ── Mode GLOBAL : cascade tous les livres ─────────────────────────
    const { data, error } = await supabaseAdmin.rpc('delete_asset_global', {
      p_asset_type: type,
      p_asset_id: id,
    })
    if (error) throw error
    return NextResponse.json({ ok: true, ...(data as object) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/assets/[type]/[id] DELETE]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
