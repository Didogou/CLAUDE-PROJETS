import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'

export const maxDuration = 30

/**
 * POST /api/editor/semantic-placement
 *
 * Demande à Claude Vision où placer un élément sur une image à partir d'une
 * description en langage naturel.
 *
 * Body : {
 *   image_url: string,    // URL de l'image cible (pano flat ou plan)
 *   description: string,  // ex : "sur l'estrade en arrière-plan"
 *   reference_url?: string, // portrait du NPC pour aider Claude
 *   element_type?: 'npc' | 'item' | 'choice', // pour tuner le prompt
 * }
 *
 * Retour : {
 *   theta: number,  // 0-360 (x normalisé × 360)
 *   phi: number,    // -90 à 90 (y normalisé centré sur 0)
 *   scale?: number, // suggestion de taille basée sur la profondeur apparente
 *   reason: string, // explication courte pour debug/UI
 * }
 *
 * Coût : ~$0.003-0.005 par appel (Haiku Vision avec 1-2 images). Négligeable.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      image_url: string
      description: string
      reference_url?: string
      element_type?: 'npc' | 'item' | 'choice'
    }
    if (!body.image_url || !body.description) {
      return NextResponse.json({ error: 'image_url et description requis' }, { status: 400 })
    }

    const sceneImg = await fetchAsBase64(body.image_url)
    const referenceImg = body.reference_url ? await fetchAsBase64(body.reference_url) : null

    const elementLabel = body.element_type === 'item' ? 'objet'
      : body.element_type === 'choice' ? 'ancre de choix cliquable'
      : 'personnage'

    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string } }
    > = [
      { type: 'text', text: `Voici la scène où placer un ${elementLabel} :` },
      { type: 'image', source: { type: 'base64', media_type: sceneImg.mediaType, data: sceneImg.data } },
    ]

    if (referenceImg) {
      content.push({ type: 'text', text: `Voici le ${elementLabel} à placer (pour contexte visuel) :` })
      content.push({ type: 'image', source: { type: 'base64', media_type: referenceImg.mediaType, data: referenceImg.data } })
    }

    content.push({
      type: 'text',
      text:
        `Description de la position désirée : « ${body.description} »\n\n` +
        `Analyse l'image et détermine la position de placement optimale.\n` +
        `Retourne UNIQUEMENT un JSON strict (pas de markdown, pas de préambule) :\n` +
        `{\n` +
        `  "x_norm": <float 0-1>,  // position horizontale normalisée (0=gauche, 1=droite)\n` +
        `  "y_norm": <float 0-1>,  // position verticale normalisée (0=haut, 1=bas)\n` +
        `  "scale_hint": <float 0.3-2>,  // taille suggérée selon profondeur (petit=au fond, grand=premier plan)\n` +
        `  "reason": "<phrase FR courte expliquant pourquoi cette position>"\n` +
        `}\n\n` +
        `Si la description est ambigüe ou impossible à satisfaire, place au meilleur endroit raisonnable et explique-le dans reason.`,
    })

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content }],
    })

    const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    if (!text) return NextResponse.json({ error: 'Réponse vide du juge' }, { status: 502 })

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'JSON non trouvé', raw: text.slice(0, 300) }, { status: 502 })

    let parsed: { x_norm?: number; y_norm?: number; scale_hint?: number; reason?: string }
    try { parsed = JSON.parse(jsonMatch[0]) } catch {
      return NextResponse.json({ error: 'JSON invalide', raw: text.slice(0, 300) }, { status: 502 })
    }

    const x = clamp(parsed.x_norm ?? 0.5, 0, 1)
    const y = clamp(parsed.y_norm ?? 0.5, 0, 1)
    const scale = clamp(parsed.scale_hint ?? 1, 0.2, 3)

    // Convertit en sphériques (cohérent avec l'ImageEditor)
    const theta = x * 360
    const phi = -(y - 0.5) * 180
    const reason = parsed.reason ?? ''

    return NextResponse.json({ theta, phi, scale, reason })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[editor/semantic-placement] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

async function fetchAsBase64(url: string): Promise<{ data: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch ${res.status} pour ${url.slice(0, 100)}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const data = buffer.toString('base64')
  const ct = res.headers.get('content-type') ?? 'image/png'
  const mediaType = (
    ct.includes('jpeg') || ct.includes('jpg') ? 'image/jpeg' :
    ct.includes('webp') ? 'image/webp' :
    ct.includes('gif')  ? 'image/gif'  :
    'image/png'
  ) as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  return { data, mediaType }
}
