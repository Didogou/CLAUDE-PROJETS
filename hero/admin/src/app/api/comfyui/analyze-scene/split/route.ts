/**
 * POST /api/comfyui/analyze-scene/split
 *
 * Persistance du split client-side des détections multi-contour.
 *
 * Le client (helper splitDetectionsByContour) :
 *   1. A chargé les masks groupés
 *   2. A extrait les contours via magic-wand-tool
 *   3. A re-rasterisé chaque contour individuel en data URL PNG
 *   4. POST ici avec les nouvelles détections + URLs des masks groupés à effacer
 *
 * Cet endpoint :
 *   1. Pour chaque détection `is_split` : décode le data URL → upload sur
 *      Supabase Storage → assigne le mask_url réel
 *   2. PATCH la ligne `scene_analyses` avec le tableau final
 *   3. Supprime les masks groupés obsolètes du Storage
 *   4. Renvoie le tableau final avec mask_urls réels
 *
 * Body :
 *   {
 *     image_url: string,
 *     image_width: number,
 *     image_height: number,
 *     detections: Array<SplitOutputDetection>,  // is_split=true → mask_data_url
 *     obsolete_mask_urls: string[],
 *   }
 *
 * Réponse : { detections: SceneDetection[], removed_files: number }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

interface SplitInDetection {
  id: string
  label: string
  bbox: [number, number, number, number]
  bbox_pixels: [number, number, number, number]
  source?: 'dense' | 'od'
  is_split: boolean
  mask_data_url?: string
  mask_url?: string | null
  parent_id?: string
}

interface SplitOutDetection {
  id: string
  label: string
  bbox: [number, number, number, number]
  bbox_pixels: [number, number, number, number]
  source?: 'dense' | 'od'
  mask_url: string | null
}

/** Sanitize un label pour usage dans un path Storage. */
function labelSafe(label: string): string {
  return label.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'obj'
}

/**
 * Déduit le path prefix Supabase pour les masks d'analyse.
 * Identique à celui utilisé par /api/comfyui/analyze-scene (même règle).
 */
function deriveAnalysisPrefix(imageUrl: string): string {
  const m = imageUrl.match(/\/object\/public\/images\/(.+)$/)
  if (!m) {
    let h = 0
    for (let i = 0; i < imageUrl.length; i++) h = ((h << 5) - h + imageUrl.charCodeAt(i)) | 0
    return `analyses/url_${(h >>> 0).toString(36).slice(0, 8)}`
  }
  const parts = m[1].split('/')
  const filename = (parts[parts.length - 1] ?? 'unknown').replace(/\.[^.]+$/, '')
  const dirParts = parts.slice(0, -1)
  if (dirParts.length > 0 && dirParts[dirParts.length - 1] === 'variants') {
    dirParts[dirParts.length - 1] = 'analyses'
  } else {
    dirParts.push('analyses')
  }
  dirParts.push(filename)
  return dirParts.join('/')
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const m = dataUrl.match(/^data:image\/png;base64,(.+)$/)
  if (!m) throw new Error('mask_data_url must be a PNG data URL')
  return Buffer.from(m[1], 'base64')
}

/** Extrait le path Storage relatif d'une URL publique Supabase. */
function storagePathFromUrl(url: string): string | null {
  const m = url.match(/\/object\/public\/images\/(.+)$/)
  return m ? m[1] : null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      image_url: string
      image_width: number
      image_height: number
      detections: SplitInDetection[]
      obsolete_mask_urls: string[]
    }

    const { image_url, image_width, image_height, detections, obsolete_mask_urls } = body

    if (!image_url || !Array.isArray(detections)) {
      return NextResponse.json({ error: 'image_url et detections requis' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const prefix = deriveAnalysisPrefix(image_url)
    const baseUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL!}/storage/v1/object/public/images/`

    // 1. Upload des masks splittés. On parallélise par batchs raisonnables
    //    pour éviter de surcharger Supabase (mais reste rapide pour ~10-20 splits).
    const finalDetections: SplitOutDetection[] = []
    let uploadErrors = 0

    for (const d of detections) {
      if (!d.is_split) {
        // Détection non modifiée : on garde le mask_url existant
        finalDetections.push({
          id: d.id,
          label: d.label,
          bbox: d.bbox,
          bbox_pixels: d.bbox_pixels,
          source: d.source,
          mask_url: d.mask_url ?? null,
        })
        continue
      }

      if (!d.mask_data_url) {
        console.warn('[split] missing mask_data_url for split detection:', d.id)
        uploadErrors++
        continue
      }

      try {
        const buf = dataUrlToBuffer(d.mask_data_url)
        const path = `${prefix}_split_${labelSafe(d.label)}_${d.id.slice(-8)}.png`
        const { error: upErr } = await supabase.storage
          .from('images')
          .upload(path, buf, { contentType: 'image/png', upsert: true })
        if (upErr) {
          console.warn('[split] upload failed for', d.id, upErr.message)
          uploadErrors++
          continue
        }
        finalDetections.push({
          id: d.id,
          label: d.label,
          bbox: d.bbox,
          bbox_pixels: d.bbox_pixels,
          source: d.source,
          mask_url: `${baseUrl}${path}`,
        })
      } catch (err) {
        console.warn('[split] exception for', d.id, err)
        uploadErrors++
      }
    }

    // 2. PATCH la ligne scene_analyses avec le tableau final.
    //    On utilise upsert au cas où la ligne aurait été créée juste avant
    //    (idempotent sur image_url).
    const { error: upsertErr } = await supabase
      .from('scene_analyses')
      .update({
        detections: finalDetections,
        image_width,
        image_height,
        updated_at: new Date().toISOString(),
      })
      .eq('image_url', image_url)

    if (upsertErr) {
      console.warn('[split] DB update failed:', upsertErr.message)
      // On continue quand même (les fichiers sont uploadés, la DB sera
      // re-synchronisée au prochain run d'analyze-scene).
    }

    // 3. Suppression des masks groupés obsolètes du Storage. On ne le fait
    //    que si l'upload + l'update DB ont réussi (rollback-safe, on ne
    //    perd pas l'ancienne ressource si quelque chose a foiré avant).
    let removedFiles = 0
    if (uploadErrors === 0 && !upsertErr && obsolete_mask_urls.length > 0) {
      const paths = obsolete_mask_urls
        .map(storagePathFromUrl)
        .filter((p): p is string => !!p)
      if (paths.length > 0) {
        const { error: rmErr, data: rmData } = await supabase.storage
          .from('images')
          .remove(paths)
        if (rmErr) {
          console.warn('[split] remove obsolete failed:', rmErr.message)
        } else {
          removedFiles = rmData?.length ?? paths.length
        }
      }
    }

    return NextResponse.json({
      ok: uploadErrors === 0,
      detections: finalDetections,
      upload_errors: uploadErrors,
      removed_files: removedFiles,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[analyze-scene/split] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
