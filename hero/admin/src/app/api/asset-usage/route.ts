/**
 * /api/asset-usage — manage les refs cross-livres (refonte 2026-05-13)
 *
 * POST   body = { asset_type, asset_id, book_id, section_id? }
 *        → ajoute une ref. Idempotent (UNIQUE constraint, retourne ok si existe).
 *        Cas d'usage : "Importer depuis un livre" → create ref dans current
 *        book/section.
 *
 * DELETE ?asset_type=X&asset_id=Y&book_id=Z[&section_id=W]
 *        → retire 1 ref (ou plusieurs si section_id absent → toutes les sections
 *          du livre). Si dernière ref globale, l'asset devient orphelin (cleanup
 *          via job nightly).
 *
 * GET    ?asset_type=X&asset_id=Y
 *        → liste TOUTES les refs d'un asset cross-livres. Utile pour vérifier
 *          si un asset peut être supprimé safely (= comptage refs).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

// ── POST (= add ref / import) ───────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      asset_type?: string
      asset_id?: string
      book_id?: string
      section_id?: string | null
    }
    if (!body.asset_type || !body.asset_id || !body.book_id) {
      return NextResponse.json({ error: 'asset_type + asset_id + book_id requis' }, { status: 400 })
    }

    // Upsert avec UNIQUE constraint → idempotent
    const { data, error } = await supabaseAdmin
      .from('asset_usage')
      .upsert({
        asset_type: body.asset_type,
        asset_id: body.asset_id,
        book_id: body.book_id,
        section_id: body.section_id ?? null,
      }, {
        onConflict: 'asset_type,asset_id,book_id,section_id',
        ignoreDuplicates: false,
      })
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ usage: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/asset-usage POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── DELETE (= retire ref) ───────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const assetType = sp.get('asset_type')
    const assetId = sp.get('asset_id')
    const bookId = sp.get('book_id')
    const sectionId = sp.get('section_id')
    if (!assetType || !assetId || !bookId) {
      return NextResponse.json({ error: 'asset_type + asset_id + book_id requis (query params)' }, { status: 400 })
    }
    let q = supabaseAdmin
      .from('asset_usage')
      .delete()
      .eq('asset_type', assetType)
      .eq('asset_id', assetId)
      .eq('book_id', bookId)
    if (sectionId) q = q.eq('section_id', sectionId)
    const { error } = await q
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/asset-usage DELETE]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── GET (= comptage refs) ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const assetType = sp.get('asset_type')
    const assetId = sp.get('asset_id')
    if (!assetType || !assetId) {
      return NextResponse.json({ error: 'asset_type + asset_id requis' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin
      .from('asset_usage')
      .select('*')
      .eq('asset_type', assetType)
      .eq('asset_id', assetId)
    if (error) throw error
    return NextResponse.json({ usages: data, count: data?.length ?? 0 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/asset-usage GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
