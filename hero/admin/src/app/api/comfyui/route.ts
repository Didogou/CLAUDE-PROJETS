import { NextRequest, NextResponse } from 'next/server'
import {
  type ComfyUIGenerateParams,
  buildWorkflow,
  queuePrompt,
  getHistory,
  getImage,
  isServerRunning,
} from '@/lib/comfyui'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

// Supabase admin client for uploading images
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ── POST — queue a ComfyUI generation ─────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const params = await req.json() as ComfyUIGenerateParams

    if (!params.workflow_type || !params.prompt_positive) {
      return NextResponse.json(
        { error: 'workflow_type et prompt_positive requis' },
        { status: 400 },
      )
    }

    // Check ComfyUI is running
    const running = await isServerRunning()
    if (!running) {
      return NextResponse.json(
        { error: 'ComfyUI n\'est pas démarré. Lancez ComfyUI puis réessayez.' },
        { status: 503 },
      )
    }

    // Build the workflow
    const workflow = buildWorkflow(params)

    // Queue on ComfyUI
    const result = await queuePrompt(workflow)

    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      console.error('[comfyui] Node errors:', JSON.stringify(result.node_errors))
      return NextResponse.json(
        { error: 'Erreurs dans le workflow ComfyUI', details: result.node_errors },
        { status: 500 },
      )
    }

    return NextResponse.json({
      prompt_id: result.prompt_id,
      meta: {
        prompt_used: params.prompt_positive,
        style_used: params.style ?? 'realistic',
        workflow_type: params.workflow_type,
        width: params.width,
        height: params.height,
        steps: params.steps ?? 35,
        cfg: params.cfg ?? 7,
        seed: params.seed ?? -1,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[comfyui] POST error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── GET — poll for result or fetch image ──────────────────────────────────

export async function GET(req: NextRequest) {
  const promptId = req.nextUrl.searchParams.get('prompt_id')
  const action = req.nextUrl.searchParams.get('action') // 'status' | 'image'

  if (!promptId) {
    // Health check
    const running = await isServerRunning()
    return NextResponse.json({ running })
  }

  try {
    // ── Get GIF info without uploading (GIFs are too large for Supabase) ──
    if (action === 'gif_info') {
      const history = await getHistory(promptId)
      if (!history) return NextResponse.json({ error: 'Prompt non trouvé' }, { status: 404 })

      for (const output of Object.values(history.outputs)) {
        if (output.gifs && output.gifs.length > 0) {
          const gif = output.gifs[0]
          const gifUrl = `${process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188'}/api/view?filename=${encodeURIComponent(gif.filename)}&subfolder=${encodeURIComponent(gif.subfolder)}&type=${gif.type}`
          return NextResponse.json({ filename: gif.filename, gif_url: gifUrl })
        }
      }
      return NextResponse.json({ error: 'Aucun GIF trouvé' }, { status: 404 })
    }

    // ── Fetch generated image and upload to Supabase ──
    if (action === 'image') {
      const storagePath = req.nextUrl.searchParams.get('storage_path')
      if (!storagePath) {
        return NextResponse.json({ error: 'storage_path requis' }, { status: 400 })
      }

      const history = await getHistory(promptId)
      if (!history) {
        return NextResponse.json({ error: 'Prompt non trouvé' }, { status: 404 })
      }

      // Find first output image or gif
      let imageInfo: { filename: string; subfolder: string; type: string } | null = null
      for (const output of Object.values(history.outputs)) {
        if (output.images && output.images.length > 0) {
          imageInfo = output.images[0]
          break
        }
        if (output.gifs && output.gifs.length > 0) {
          imageInfo = output.gifs[0]
          break
        }
      }

      if (!imageInfo) {
        return NextResponse.json({ error: 'Aucune image générée' }, { status: 404 })
      }

      // Download from ComfyUI
      console.log(`[comfyui] Fetching ${imageInfo.filename} (${imageInfo.type})`)
      const imageBuffer = await getImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type)
      console.log(`[comfyui] Downloaded ${imageBuffer.length} bytes`)

      // Upload to Supabase Storage
      const supabase = getSupabaseAdmin()
      const ext = imageInfo.filename.split('.').pop() ?? 'png'
      const contentType = ext === 'gif' ? 'image/gif' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
      const fullPath = `${storagePath}.${ext}`

      console.log(`[comfyui] Uploading to Supabase: ${fullPath} (${contentType}, ${imageBuffer.length} bytes)`)
      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(fullPath, imageBuffer, {
          contentType,
          upsert: true,
        })

      if (uploadError) throw new Error(`Upload Supabase échoué: ${uploadError.message}`)

      const { data: { publicUrl } } = supabase.storage
        .from('images')
        .getPublicUrl(fullPath)

      return NextResponse.json({ status: 'succeeded', image_url: publicUrl })
    }

    // ── Status polling ──
    const history = await getHistory(promptId)

    if (!history) {
      return NextResponse.json({ status: 'processing' })
    }

    if (history.status.completed) {
      // Check if there are output images or gifs
      let hasImages = false
      for (const output of Object.values(history.outputs)) {
        if ((output.images && output.images.length > 0) || (output.gifs && output.gifs.length > 0)) {
          hasImages = true
          break
        }
      }

      if (hasImages) {
        return NextResponse.json({ status: 'succeeded' })
      }
      return NextResponse.json({ status: 'failed', error: 'Génération terminée sans image' })
    }

    if (history.status.status_str === 'error') {
      return NextResponse.json({ status: 'failed', error: 'Erreur ComfyUI' })
    }

    return NextResponse.json({ status: 'processing' })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[comfyui] GET error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
