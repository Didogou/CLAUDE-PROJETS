import { NextRequest, NextResponse } from 'next/server'
import { uploadUrlToComfyUI, generateMaskPng, uploadImageToComfyUI, isServerRunning } from '@/lib/comfyui'

export const maxDuration = 30

/**
 * POST /api/comfyui/upload
 *
 * Upload images to ComfyUI's input folder before running a workflow.
 * Accepts two modes:
 *
 * 1. Upload from URL:
 *    { type: "url", url: "https://...", name: "duke_portrait" }
 *    → Downloads and uploads to ComfyUI, returns { filename }
 *
 * 2. Generate a mask:
 *    { type: "mask", preset: "left", width: 1360, height: 768 }
 *    → Generates a mask PNG and uploads to ComfyUI, returns { filename }
 */
export async function POST(req: NextRequest) {
  try {
    const running = await isServerRunning()
    if (!running) {
      return NextResponse.json(
        { error: 'ComfyUI n\'est pas démarré.' },
        { status: 503 },
      )
    }

    const body = await req.json() as {
      type: 'url' | 'mask'
      // For type=url
      url?: string
      name?: string
      // For type=mask
      preset?: string
      width?: number
      height?: number
    }

    if (body.type === 'url') {
      if (!body.url) {
        return NextResponse.json({ error: 'url requis' }, { status: 400 })
      }
      const filename = await uploadUrlToComfyUI(body.url, body.name ?? 'hero_upload')
      return NextResponse.json({ filename })
    }

    if (body.type === 'mask') {
      const preset = body.preset ?? 'full'
      const width = body.width ?? 1360
      const height = body.height ?? 768
      const maskBuffer = await generateMaskPng(
        preset as 'left' | 'right' | 'left_third' | 'center_third' | 'right_third' | 'full',
        width,
        height,
      )
      const filename = await uploadImageToComfyUI(maskBuffer, `mask_${preset}_${width}x${height}.png`)
      return NextResponse.json({ filename })
    }

    return NextResponse.json({ error: 'type doit être "url" ou "mask"' }, { status: 400 })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[comfyui/upload] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
