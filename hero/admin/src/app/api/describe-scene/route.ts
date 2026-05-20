import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'
import { ollamaVisionJSON } from '@/lib/ollama'
import { freeComfyVram } from '@/lib/comfyui'

export const maxDuration = 60

/**
 * POST /api/describe-scene
 *
 * Body : { image_url: string, mode: 'scene' | 'characters', engine?: 'qwen' | 'claude' }
 *   - mode='scene'      → décrit l'environnement / décor / ambiance
 *   - mode='characters' → décrit l'apparence des persos visibles, format
 *     Vantage compatible (`Female: ... / Male: ...` séparés par retour ligne)
 *   - engine='qwen' (défaut) : Qwen 2.5 VL 3B local via Ollama, gratuit
 *   - engine='claude' : Claude Haiku 4.5 vision, fallback / précis
 *
 * Sert à pré-remplir les champs "Description de la scène" / "Apparence des
 * persos dans la scène" du SceneDescriptionAccordion (Studio Designer plan
 * animation, cf β.1+ 2026-05-06). L'output est en EN, directement utilisable
 * dans le prompt Vantage envoyé à LTX 2.3.
 *
 * Retour : { description: string, engine_used: 'qwen' | 'claude' }
 */

type Mode = 'scene' | 'characters'

const PROMPTS: Record<Mode, string> = {
  scene:
    'Describe the SCENE / ENVIRONMENT visible in this image in 1-2 short English sentences for an LTX 2.3 video prompt. ' +
    'Focus on: location type (interior/exterior, room genre), lighting (warm/cold, time of day), key décor elements ' +
    '(furniture, architecture, materials, colors), ambiance. Do NOT describe characters at all — only the environment. ' +
    'Use comma-separated descriptors, no full prose. ' +
    'Example: "grand victorian library at golden hour, tall arched windows, dark wood bookshelves, oxblood leather sofa, crimson rug, warm afternoon sunlight". ' +
    'Output ONLY the descriptors, no preamble, no quotes, no character mentions.',

  characters:
    'Describe each VISIBLE CHARACTER in this image for an LTX 2.3 IC LoRA Dual Characters prompt. ' +
    'Output format: one line per character, prefixed by "Female:" or "Male:" (use "Female 2:" / "Male 2:" if multiple of same gender). ' +
    'For each character cover: clothing details (colors, materials, style), accessories (hat, jewelry, weapon, glass…), posture / position in frame. ' +
    'Do NOT describe facial features (the source image already provides identity). Be precise on visible accessories. ' +
    'Use comma-separated descriptors per line, no full prose, no character names. ' +
    'Example:\nMale: long brown leather duster coat, brown cowboy hat, white shirt, holding a glass of amber whiskey, standing on the left\nFemale: emerald green strapless dress, short wavy black hair, sitting upright on the leather sofa on the right\n' +
    'Output ONLY the lines, no preamble, no extra commentary.',
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      image_url?: string
      mode?: Mode
      engine?: 'qwen' | 'claude'
    }
    const { image_url } = body
    const mode = body.mode
    // Refonte 2026-05-14bc — default basculé Qwen → Claude après validation
    // que Qwen 2.5 VL via Ollama 0.13.3 crash le model runner en GPU sur ce
    // setup (cf [[ollama-pin-0-13-3]]). Claude Haiku Vision = ~$0.001/image,
    // négligeable, fiable. Qwen reste possible via engine='qwen' explicite.
    const engine = body.engine ?? 'claude'

    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })
    if (mode !== 'scene' && mode !== 'characters') {
      return NextResponse.json({ error: 'mode doit être "scene" ou "characters"' }, { status: 400 })
    }

    // Download image en base64 (les vision models attendent du base64)
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

    const instruction = PROMPTS[mode]

    // Pour le mode 'characters', on extrait via JSON (output multi-lignes
    // donc on a besoin de structurer). Pour 'scene', output texte simple OK.
    let description = ''

    if (engine === 'qwen') {
      // Refonte 2026-05-14ba — Free ComfyUI VRAM AVANT call Qwen.
      // Sans ça, Qwen 3B (3.2 GB) ne tient pas en GPU si ComfyUI a un
      // gros modèle résident → fallback CPU = 60-180s/image (= timeout).
      // freeComfyVram() est best-effort silencieux (no-op si ComfyUI down).
      try { await freeComfyVram() } catch { /* ignore */ }
      try {
        const result = await ollamaVisionJSON<{ description?: string }>({
          system:
            'You are a precise visual analyst that outputs JSON with a single field "description". The description value is a string (may contain newlines for multi-line outputs). Never output anything other than the JSON object.',
          prompt: instruction,
          images: [base64],
          temperature: 0.2,
          // Refonte 2026-05-14br — 45s trop court quand ComfyUI cohabite
          // sur 8 GB VRAM (Qwen doit swap, peut prendre 50-80s). 90s donne
          // de la marge tout en évitant un freeze infini si Ollama down.
          timeoutMs: 90_000,
        })
        description = (result.description ?? '').trim()
      } catch (err) {
        // Fallback Claude si Qwen down / modèle pas pull
        const errMsg = err instanceof Error ? err.message : String(err)
        console.warn(`[describe-scene] Qwen failed (mode=${mode}), fallback Claude:`, errMsg)
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: instruction },
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
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: instruction },
          ],
        }],
      })
      description = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    }

    if (!description) return NextResponse.json({ error: 'Description vide' }, { status: 502 })
    return NextResponse.json({ description, engine_used: engine })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[describe-scene] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
