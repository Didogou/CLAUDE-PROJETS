import { NextResponse } from 'next/server'
import { bulkCleanupComfyOutput } from '@/lib/comfyui-output-cleanup'

/**
 * POST /api/comfyui/cleanup-output
 *
 * One-shot : scan ComfyUI/output/ et supprime tous les fichiers générés par
 * notre pipeline scene-analyzer (scene_*, hero_*).
 *
 * Cas d'usage : rattrapage de l'accumulation existante (avant mise en place
 * du cleanup auto par fichier). À hit manuellement via fetch ou cURL.
 *
 *   curl -X POST http://localhost:3000/api/comfyui/cleanup-output
 *
 * Retourne : { scanned, removed, errors, kept, output_dir }
 */
export async function POST() {
  try {
    const stats = await bulkCleanupComfyOutput()
    console.log('[cleanup-output] stats:', stats)
    return NextResponse.json({ ok: true, ...stats })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
