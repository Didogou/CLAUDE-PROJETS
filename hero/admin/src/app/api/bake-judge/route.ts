import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'

export const maxDuration = 30

/**
 * POST /api/bake-judge
 *
 * Juge automatique (Claude Haiku Vision) pour les bakes 360° : vérifie qu'un
 * crop inpainted SDXL+FaceID produit un résultat cohérent et matche le prompt.
 *
 * Body : {
 *   candidate_url: string,   // URL du crop inpainted à juger
 *   reference_url: string,   // URL du portrait/plein-pied de référence du NPC
 *   prompt: string,          // Prompt de bake utilisé
 *   npc_name?: string        // Optionnel, aide à contextualiser
 * }
 *
 * Retour : {
 *   score: number (0-10),
 *   verdict: 'pass' | 'fail',
 *   reason: string           // 1 phrase explicative (debug + UI)
 * }
 *
 * Critères évalués :
 *   - Exactement UNE personne (pas de doubles)
 *   - Ressemblance au portrait de référence (visage, ethnie, tenue)
 *   - Action/pose matche le prompt
 *   - Anatomie cohérente (pas de mains déformées, membres manquants, etc.)
 *   - Intégration avec le décor (éclairage, échelle)
 */

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      candidate_url: string
      reference_url: string
      prompt: string
      npc_name?: string
    }
    if (!body.candidate_url || !body.reference_url || !body.prompt) {
      return NextResponse.json({ error: 'candidate_url, reference_url et prompt requis' }, { status: 400 })
    }

    const [candidate, reference] = await Promise.all([
      fetchAsBase64(body.candidate_url),
      fetchAsBase64(body.reference_url),
    ])

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'REFERENCE PORTRAIT (le personnage qu\'on veut baker dans la scène) :' },
          { type: 'image', source: { type: 'base64', media_type: reference.mediaType, data: reference.data } },
          { type: 'text', text: 'CANDIDATE (résultat de l\'inpaint SDXL+FaceID à juger) :' },
          { type: 'image', source: { type: 'base64', media_type: candidate.mediaType, data: candidate.data } },
          {
            type: 'text',
            text:
              `Nom du personnage : ${body.npc_name ?? 'inconnu'}\n` +
              `Prompt de baking demandé : "${body.prompt}"\n\n` +
              `Juge la CANDIDATE selon ces critères stricts :\n` +
              `1. Exactement UNE personne visible (pas de doubles, pas de clones, pas de copies floues à l'arrière-plan)\n` +
              `2. Ressemblance physique raisonnable au portrait de REFERENCE (ethnie, coiffure, traits principaux)\n` +
              `3. Action/pose correspondent au prompt demandé\n` +
              `4. Anatomie cohérente (pas de doigts fusionnés, bras déformés, visage mutilé)\n` +
              `5. Intégration plausible dans la scène (échelle, éclairage)\n\n` +
              `Réponds UNIQUEMENT en JSON strict (pas de markdown, pas de préambule) au format :\n` +
              `{"score": <int 0-10>, "verdict": "pass" | "fail", "reason": "<1 phrase FR expliquant le score>"}\n\n` +
              `Barème : 9-10 = excellent, 7-8 = bon, 5-6 = moyen acceptable, <5 = fail (retry).`,
          },
        ],
      }],
    })

    const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    if (!text) return NextResponse.json({ error: 'Réponse vide du juge' }, { status: 502 })

    // Parse JSON tolérant (au cas où Claude ajoute un préambule malgré la consigne)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'JSON non trouvé', raw: text.slice(0, 300) }, { status: 502 })
    }
    let parsed: { score?: number; verdict?: string; reason?: string }
    try { parsed = JSON.parse(jsonMatch[0]) } catch (e) {
      return NextResponse.json({ error: 'JSON invalide', raw: text.slice(0, 300) }, { status: 502 })
    }

    const score = Math.max(0, Math.min(10, Math.round(parsed.score ?? 0)))
    const verdict = parsed.verdict === 'pass' ? 'pass' as const : 'fail' as const
    const reason = parsed.reason ?? ''

    return NextResponse.json({ score, verdict, reason })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[bake-judge] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
