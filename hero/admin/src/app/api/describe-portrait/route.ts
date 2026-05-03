import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'

export const maxDuration = 30

/**
 * POST /api/describe-portrait
 *
 * Body : { image_url: string }
 *
 * Demande à Claude (vision) de produire une description physique courte du
 * personnage présent dans l'image. Sert à enrichir automatiquement le prompt
 * des régen plein-pied / variantes (cf. helper regenerateCharacterVariants).
 *
 * Retour : { description: string } — 1-2 phrases en anglais (langue native
 * pour les modèles SDXL ; les modèles Pony recevront une traduction Danbooru
 * en aval).
 */
export async function POST(req: NextRequest) {
  try {
    const { image_url } = await req.json() as { image_url: string }
    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })

    // Téléchargement de l'image (Claude vision attend du base64 ou une URL)
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
      max_tokens: 250,
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
              'Describe this character physically in 1-2 short English sentences for an SDXL prompt. ' +
              'Cover: gender, ethnicity, age range, build, hair, clothing, accessories. ' +
              'Use comma-separated descriptors, no full prose. ' +
              'Example: "young black-skinned man, athletic build, short black hair, dark bomber jacket, gold chain necklace, baseball cap, serious expression". ' +
              'Output ONLY the descriptors, no preamble.',
          },
        ],
      }],
    })
    const description = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    if (!description) return NextResponse.json({ error: 'Description vide' }, { status: 502 })
    return NextResponse.json({ description })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[describe-portrait] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
