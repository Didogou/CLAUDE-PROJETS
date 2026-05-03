import { NextRequest, NextResponse } from 'next/server'
import {
  buildAnglePrompt,
  buildQwenMultiangleWorkflow,
  isServerRunning,
  queuePrompt,
  uploadUrlToComfyUI,
} from '@/lib/comfyui'

export const maxDuration = 60

/**
 * POST /api/comfyui/qwen-travelling
 *
 * Generates a "travelling" — N images of the same scene under slightly different
 * camera angles, using Qwen Image Edit 2511 + multi-angles LoRA.
 *
 * Body:
 *   {
 *     source_url: string         // Supabase URL of the source image
 *     start_angle?: number       // horizontal angle in degrees, default -15
 *     end_angle?: number         // horizontal angle in degrees, default +15
 *     vertical_angle?: number    // pitch, default 0
 *     zoom?: number              // 0..10, default 5 (medium)
 *     frame_count?: number       // default 30
 *     seed?: number              // -1 = random per frame, otherwise fixed
 *     negative_prompt?: string
 *   }
 *
 * Returns:
 *   { prompt_ids: string[], angles: number[], source_filename: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      source_url?: string
      start_angle?: number
      end_angle?: number
      vertical_angle?: number
      zoom?: number
      frame_count?: number
      seed?: number
      negative_prompt?: string
      /** Template optionnel — utilise `{angle}` comme placeholder pour la direction.
       *  Si fourni, remplace le prompt auto-généré pour chaque frame. */
      prompt_template?: string
    }

    if (!body.source_url) {
      return NextResponse.json({ error: 'source_url requis' }, { status: 400 })
    }

    const running = await isServerRunning()
    if (!running) {
      return NextResponse.json(
        { error: 'ComfyUI n\'est pas démarré. Lancez ComfyUI puis réessayez.' },
        { status: 503 },
      )
    }

    const startAngle = body.start_angle ?? -15
    const endAngle = body.end_angle ?? 15
    const verticalAngle = body.vertical_angle ?? 0
    const zoom = body.zoom ?? 5
    const frameCount = Math.max(2, Math.min(60, body.frame_count ?? 30))
    const fixedSeed = body.seed != null && body.seed !== -1

    // Upload source image to ComfyUI input folder once
    const sourceFilename = await uploadUrlToComfyUI(body.source_url, `qwen_src_${Date.now()}`)

    // Queue one workflow per angle
    const promptIds: string[] = []
    const angles: number[] = []

    for (let i = 0; i < frameCount; i++) {
      const t = frameCount === 1 ? 0 : i / (frameCount - 1)
      const angle = startAngle + (endAngle - startAngle) * t
      const autoAnglePrompt = buildAnglePrompt(angle, verticalAngle, zoom)
      // Si template fourni avec {angle} → substitution ; si template sans placeholder → utilisé tel quel
      const promptText = body.prompt_template && body.prompt_template.trim().length > 0
        ? body.prompt_template.replace(/\{angle\}/g, autoAnglePrompt)
        : autoAnglePrompt

      const workflow = buildQwenMultiangleWorkflow({
        workflow_type: 'qwen_multiangle',
        source_image: sourceFilename,
        prompt_positive: promptText,
        prompt_negative: body.negative_prompt,
        seed: fixedSeed ? body.seed : -1,
      })

      const result = await queuePrompt(workflow)

      if (result.node_errors && Object.keys(result.node_errors).length > 0) {
        console.error('[qwen-travelling] node errors:', JSON.stringify(result.node_errors))
        return NextResponse.json(
          { error: 'Erreurs dans le workflow Qwen', details: result.node_errors, queued: promptIds },
          { status: 500 },
        )
      }

      promptIds.push(result.prompt_id)
      angles.push(Number(angle.toFixed(1)))
    }

    return NextResponse.json({
      prompt_ids: promptIds,
      angles,
      source_filename: sourceFilename,
      frame_count: frameCount,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[qwen-travelling] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
