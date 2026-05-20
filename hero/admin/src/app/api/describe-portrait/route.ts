import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'
import { ollamaVisionJSON } from '@/lib/ollama'

export const maxDuration = 60

/**
 * POST /api/describe-portrait
 *
 * Body : { image_url: string, engine?: 'qwen' | 'claude' }
 *   - engine='qwen' (défaut) : Qwen 2.5 VL 3B local via Ollama, GRATUIT
 *   - engine='claude' : Claude Haiku 4.5 vision, payant mais plus précis
 *
 * Demande au modèle vision de produire une description physique courte du
 * personnage présent dans l'image. Sert à enrichir automatiquement le prompt
 * des régen plein-pied / variantes (cf. CharacterCreatorModal.generateFullbody).
 *
 * Retour : { description: string, engine_used: 'qwen' | 'claude' }
 *   description = 1-2 phrases en anglais, comma-separated descriptors
 *   (gender, ethnicity, age, build, hair, clothing, accessories).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { image_url: string; engine?: 'qwen' | 'claude' }
    const { image_url } = body
    // Refonte 2026-05-14bc — default Claude. Setup Ollama 0.13.3 + Qwen VL
    // crash le model runner sur 8 GB VRAM (cf [[ollama-pin-0-13-3]]). On
    // bascule sur Claude Haiku Vision (~$0.001/image) en attendant un GPU
    // plus capable. La branche Qwen reste accessible via engine='qwen'.
    const engine = body.engine ?? 'claude'
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

    // Prompt commun aux 2 engines (Qwen + Claude) — format SDXL-friendly
    const VISION_INSTRUCTION =
      'Describe this character physically in 1-2 short English sentences for an SDXL prompt. ' +
      'Cover: gender, ethnicity, age range, build, hair color and style, clothing details (colors, materials, style), ' +
      'accessories (hat, glasses, jewelry…), expression. Be VERY precise on accessories — exact type, color, position. ' +
      'Use comma-separated descriptors, no full prose. ' +
      'Example: "young black-skinned man, athletic build, short black hair, dark bomber jacket, gold chain necklace, baseball cap tilted back, serious expression". ' +
      'Output ONLY the descriptors, no preamble, no quotes.'

    let description = ''

    if (engine === 'qwen') {
      // Qwen 2.5 VL 3B local via Ollama — gratuit, ~5-10s pour 1 image
      try {
        const result = await ollamaVisionJSON<{ description?: string }>({
          system:
            'You are a precise visual analyst that outputs JSON with a single field "description" containing comma-separated SDXL descriptors. Never output anything other than the JSON object.',
          prompt: VISION_INSTRUCTION,
          images: [base64],
          temperature: 0.2,
          // Refonte 2026-05-14br — aligné describe-scene : 90s pour cohabiter
          // avec ComfyUI sur 8 GB VRAM sans déclencher fallback Claude inutile.
          timeoutMs: 90_000,
        })
        description = (result.description ?? '').trim()
      } catch (err) {
        // Qwen down ou modèle pas pull → fallback Claude
        const errMsg = err instanceof Error ? err.message : String(err)
        console.warn('[describe-portrait] Qwen failed, fallback Claude:', errMsg)
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 250,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: VISION_INSTRUCTION },
            ],
          }],
        })
        description = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
        if (description) {
          return NextResponse.json({ description, engine_used: 'claude', fallback_reason: errMsg })
        }
      }
    } else {
      // Mode 'claude' explicite
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: VISION_INSTRUCTION },
          ],
        }],
      })
      description = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    }

    if (!description) return NextResponse.json({ error: 'Description vide' }, { status: 502 })
    return NextResponse.json({ description, engine_used: engine })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[describe-portrait] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
