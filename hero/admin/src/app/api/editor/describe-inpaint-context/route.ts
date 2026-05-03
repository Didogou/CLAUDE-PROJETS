import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'

export const maxDuration = 30

/**
 * POST /api/editor/describe-inpaint-context
 *
 * Body : { image_url: string }
 *
 * Regarde l'image via Claude Vision et retourne un prompt SDXL décrivant
 * le BACKGROUND/environnement (hors sujet central), pour inpaint sans
 * intervention de l'utilisateur.
 *
 * Usage : FoldCut → bouton "Supprimer" en mode Inpaint → auto-prompt →
 * /api/comfyui/inpaint. 100% transparent pour l'utilisateur.
 *
 * Retour : { prompt: string } — 1-2 phrases en anglais, format descripteur
 * pour Juggernaut XL v9 / SDXL.
 */
export async function POST(req: NextRequest) {
  try {
    const { image_url } = await req.json() as { image_url: string }
    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })

    // Télécharge l'image en base64 pour Claude Vision
    const imgRes = await fetch(image_url)
    if (!imgRes.ok) return NextResponse.json({ error: `Image inaccessible (${imgRes.status})` }, { status: 400 })
    const buffer = Buffer.from(await imgRes.arrayBuffer())
    const base64 = buffer.toString('base64')
    const contentType = imgRes.headers.get('content-type') ?? 'image/png'
    const mediaType = (
      contentType.includes('jpeg') || contentType.includes('jpg') ? 'image/jpeg' :
      contentType.includes('webp') ? 'image/webp' :
      contentType.includes('gif')  ? 'image/gif'  :
      'image/png'
    ) as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text:
              'This scene contains a subject (person/object) that will be REMOVED via AI inpainting. ' +
              'Describe in 1-2 short English sentences what the BACKGROUND/ENVIRONMENT looks like around the subject, ' +
              'so an AI can fill the empty region plausibly. ' +
              'Focus on: setting, lighting, colors, supporting elements (crowd, trees, buildings, sky, texture). ' +
              'IGNORE the central subject / main character / object being removed. ' +
              'Use comma-separated descriptors, no full prose. ' +
              'Example: "dense crowd of people at night, orange sodium street lamps, dark silhouettes, city skyline, park environment, warm glow". ' +
              'Output ONLY the descriptors, no preamble, no explanation.',
          },
        ],
      }],
    })

    const prompt = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    if (!prompt) return NextResponse.json({ error: 'Prompt vide' }, { status: 502 })
    return NextResponse.json({ prompt })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[describe-inpaint-context] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
