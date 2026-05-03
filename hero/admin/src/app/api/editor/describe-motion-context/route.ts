import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'

export const maxDuration = 30

/**
 * POST /api/editor/describe-motion-context
 *
 * Body : { image_url: string }
 *
 * Regarde l'image (un PNG RGBA du sujet extrait, fond transparent) via Claude
 * Vision et retourne un prompt motion_brush / AnimateDiff adapté au CONTENU
 * détecté.
 *
 * Exemples attendus selon le sujet :
 *   - Arbre avec feuilles → "leaves gently swaying in the wind, branches moving subtly"
 *   - Drapeau → "flag waving in the breeze, fabric rippling"
 *   - Personnage debout → "character breathing gently, subtle idle motion"
 *   - Flamme/feu → "flames flickering, fire dancing, embers rising"
 *   - Eau → "water rippling, gentle waves"
 *
 * Utilisé par FoldAnimationBake pour que l'utilisateur n'ait RIEN à saisir.
 *
 * Retour : { prompt: string } — 1-2 phrases EN descripteur style AnimateDiff.
 */
export async function POST(req: NextRequest) {
  try {
    const { image_url } = await req.json() as { image_url: string }
    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })

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
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          {
            type: 'text',
            text:
              'This is a subject extracted for animation (AnimateDiff / motion_brush). ' +
              'Describe in 1-2 short English sentences what NATURAL SUBTLE MOTION would look realistic ' +
              'for this subject — the kind of motion you\'d animate with AI. ' +
              'Examples by subject type :\n' +
              '- Tree with leaves : "leaves gently swaying in the wind, branches moving subtly, natural breeze"\n' +
              '- Character standing : "character breathing gently, subtle idle sway, slight weight shift"\n' +
              '- Flag / fabric : "fabric rippling, gentle waving in breeze, flowing motion"\n' +
              '- Flame / fire : "flames flickering, embers rising, fire dancing"\n' +
              '- Water : "water rippling, gentle wave motion"\n' +
              '- Smoke : "smoke drifting upward, wisps curling"\n' +
              'Use comma-separated descriptors, no full prose. ' +
              'Focus on the GESTURE/MOTION, not the appearance of the subject. ' +
              'Output ONLY the descriptors, no preamble.',
          },
        ],
      }],
    })

    const prompt = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    if (!prompt) return NextResponse.json({ error: 'Prompt vide' }, { status: 502 })
    return NextResponse.json({ prompt })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[describe-motion-context] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
