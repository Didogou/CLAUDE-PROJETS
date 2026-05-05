import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 10

/**
 * GET /api/comfyui/analyze-scene/cache-check?image_url=X&strategy=Y
 *
 * Vérifie si une analyse existe déjà dans `scene_analyses` pour cette image_url
 * (et stratégie). Permet au hook usePreAnalyzeImage de savoir s'il doit afficher
 * la popup de confirmation (cache vide) ou loader directement (cache hit).
 *
 * Retour : { cached: boolean, detectionsCount?: number }
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const imageUrl = url.searchParams.get('image_url')
    const strategy = url.searchParams.get('strategy') ?? 'f_qwen_sam1hq'

    if (!imageUrl) {
      return NextResponse.json({ error: 'image_url requis' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data, error } = await supabase
      .from('scene_analyses')
      .select('detections, strategy')
      .eq('image_url', imageUrl)
      .maybeSingle()

    if (error) {
      console.warn('[cache-check] DB error:', error.message)
      return NextResponse.json({ cached: false, error: error.message })
    }

    const cached = !!(data && data.strategy === strategy)
    const detectionsCount = cached
      ? (Array.isArray(data?.detections) ? data.detections.length : 0)
      : 0

    return NextResponse.json({ cached, detectionsCount })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cache-check]', message)
    return NextResponse.json({ cached: false, error: message }, { status: 500 })
  }
}
