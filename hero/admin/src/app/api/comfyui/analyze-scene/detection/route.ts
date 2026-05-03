/**
 * DELETE /api/comfyui/analyze-scene/detection
 *
 * Supprime UNE détection précise du catalogue (gomme on-image dans le Designer).
 *   - Retire le mask PNG du Storage Supabase
 *   - Retire l'entrée du tableau `detections` JSONB dans `scene_analyses`
 *
 * Image de base intacte — non destructif sur la source.
 *
 * Body : { image_url: string, detection_id: string, mask_url?: string | null }
 *
 * Réponse : { ok: boolean, removed_file: boolean, remaining: number }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface DetectionRow {
  id: string
  label?: string
  bbox?: [number, number, number, number]
  bbox_pixels?: [number, number, number, number]
  source?: 'dense' | 'od'
  mask_url?: string | null
}

function storagePathFromUrl(url: string): string | null {
  const m = url.match(/\/object\/public\/images\/(.+)$/)
  return m ? m[1] : null
}

export async function DELETE(req: NextRequest) {
  try {
    const { image_url, detection_id, mask_url } = await req.json() as {
      image_url?: string
      detection_id?: string
      mask_url?: string | null
    }
    if (!image_url || !detection_id) {
      return NextResponse.json({ error: 'image_url et detection_id requis' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // 1. Récupère le tableau detections existant pour le filtrer
    const { data: row, error: fetchErr } = await supabase
      .from('scene_analyses')
      .select('detections')
      .eq('image_url', image_url)
      .maybeSingle()

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }
    if (!row) {
      return NextResponse.json({ error: 'scene_analyses row not found' }, { status: 404 })
    }

    const detections = Array.isArray(row.detections) ? row.detections as DetectionRow[] : []
    const target = detections.find(d => d.id === detection_id)
    const remaining = detections.filter(d => d.id !== detection_id)

    // 2. Update DB (retrait de l'entrée)
    const { error: upErr } = await supabase
      .from('scene_analyses')
      .update({
        detections: remaining,
        updated_at: new Date().toISOString(),
      })
      .eq('image_url', image_url)
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    // 3. Delete mask PNG du Storage
    let removedFile = false
    const targetMaskUrl = target?.mask_url ?? mask_url
    if (targetMaskUrl) {
      const path = storagePathFromUrl(targetMaskUrl)
      if (path) {
        const { error: rmErr } = await supabase.storage.from('images').remove([path])
        if (rmErr) {
          console.warn('[DELETE detection] storage remove failed:', rmErr.message)
        } else {
          removedFile = true
        }
      }
    }

    return NextResponse.json({
      ok: true,
      removed_file: removedFile,
      remaining: remaining.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[DELETE detection] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
