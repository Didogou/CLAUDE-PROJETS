/**
 * /api/books/[id]/timeline-summary — V2 (refonte 2026-05-14)
 *
 * Retourne en 1 requête par section :
 *   - count = nombre de blocs sur la piste vidéo/image (ce que l'auteur "voit"
 *             comme plans dans la timeline)
 *   - thumbUrl = première image affichable (premier bloc video_image trié par
 *                position_idx ASC : firstFrameUrl si animation, url si image)
 *
 * Sert le Studio Creator (= grille des sections d'un livre) pour driver les
 * tiles avec le count réel V2 + le bon thumb. Remplace l'usage de
 * /api/plans?bookId=X (table legacy `plans`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: bookId } = await params

    // 1. Sections du livre
    const { data: sections, error: secErr } = await supabaseAdmin
      .from('sections')
      .select('id')
      .eq('book_id', bookId)
    if (secErr) throw secErr
    const sectionIds = (sections ?? []).map(s => s.id)
    if (sectionIds.length === 0) return NextResponse.json({ bySection: {} })

    // 2. Tous les blocs video_image de ces sections, triés par position
    const { data: blocks, error: blocksErr } = await supabaseAdmin
      .from('section_timeline')
      .select('section_id, asset_type, asset_id, position_idx')
      .in('section_id', sectionIds)
      .eq('track', 'video_image')
      .order('position_idx', { ascending: true })
    if (blocksErr) throw blocksErr

    // 3. Group : count par section + premier bloc par section
    const countBySection: Record<string, number> = {}
    const firstBlockBySection: Record<string, { asset_type: string; asset_id: string }> = {}
    for (const b of blocks ?? []) {
      countBySection[b.section_id] = (countBySection[b.section_id] ?? 0) + 1
      if (!firstBlockBySection[b.section_id]) {
        firstBlockBySection[b.section_id] = { asset_type: b.asset_type, asset_id: b.asset_id }
      }
    }

    // 4. Fetch en bulk les assets correspondants pour les thumbs (group by type)
    const idsByType: Record<string, string[]> = { image: [], animation: [] }
    for (const fb of Object.values(firstBlockBySection)) {
      if (fb.asset_type === 'image' || fb.asset_type === 'animation') {
        idsByType[fb.asset_type].push(fb.asset_id)
      }
    }
    const thumbByAsset: Record<string, Record<string, string | null>> = { image: {}, animation: {} }
    if (idsByType.image.length > 0) {
      const { data: imgs } = await supabaseAdmin
        .from('assets_image')
        .select('id, url')
        .in('id', idsByType.image)
      for (const a of imgs ?? []) thumbByAsset.image[a.id] = a.url ?? null
    }
    if (idsByType.animation.length > 0) {
      const { data: anims } = await supabaseAdmin
        .from('assets_animation')
        .select('id, first_frame_url, last_frame_url')
        .in('id', idsByType.animation)
      for (const a of anims ?? []) {
        thumbByAsset.animation[a.id] = a.first_frame_url ?? a.last_frame_url ?? null
      }
    }

    // 5. Build réponse compacte
    const bySection: Record<string, { count: number; thumbUrl: string | null }> = {}
    for (const sid of sectionIds) {
      const fb = firstBlockBySection[sid]
      const thumbUrl = fb ? (thumbByAsset[fb.asset_type]?.[fb.asset_id] ?? null) : null
      bySection[sid] = {
        count: countBySection[sid] ?? 0,
        thumbUrl,
      }
    }

    return NextResponse.json({ bySection })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/books/[id]/timeline-summary GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
