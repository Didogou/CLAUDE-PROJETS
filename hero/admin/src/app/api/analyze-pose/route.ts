import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'
import { ollamaVisionJSON, isOllamaAvailable } from '@/lib/ollama'

export const maxDuration = 30

/**
 * POST /api/analyze-pose
 *
 * Body : { image_url: string, provider?: 'auto' | 'local' | 'cloud' }
 *
 * Analyse le sujet principal d'une image (perso, animal, objet) et retourne
 * pose + orientation + view + un fragment de prompt SDXL prêt à injecter dans
 * un template de génération de référence Insert Anything.
 *
 * Providers :
 *   - 'local' : Qwen 2.5 VL 3B via Ollama (gratuit, local, SaaS-friendly)
 *   - 'cloud' : Claude Haiku 4.5 Vision (Anthropic, payant ~$0.001/appel)
 *   - 'auto' (default) : essaie 'local' d'abord, fallback 'cloud' si Ollama down
 *                       ou modèle pas pull
 *
 * Pour la prod Hero (SaaS), forcer 'local' via env var ANALYZE_POSE_PROVIDER=local
 * pour éviter les coûts Anthropic.
 *
 * Cas d'usage : avant un remplacement par référence (Insert Anything), on
 * détecte la pose/orientation du sujet à remplacer, puis on génère une nouvelle
 * référence avec ces mêmes attributs → garantit que la pose ref matche la pose
 * source (règle critique d'Insert Anything, cf. mémoire test_suite).
 *
 * Retour :
 * {
 *   pose: 'sitting' | 'standing' | 'lying' | 'kneeling' | 'leaning' | 'crouching' | 'floating',
 *   orientation: 'front' | 'three-quarter-left' | 'profile-left' | 'back' | 'profile-right' | 'three-quarter-right' | 'top-down',
 *   view_position: 'full-body' | 'half-body' | 'close-up',
 *   prompt_attributes: string,
 *   provider: 'local' | 'cloud'  // quel provider a réellement répondu
 * }
 */

interface PoseAnalysis {
  pose: string
  orientation: string
  view_position: string
  prompt_attributes: string
}

const ANALYSIS_INSTRUCTION =
  'Analyse the main subject (person, animal, or object) in this image. ' +
  'Output ONLY a JSON object (no preamble, no markdown wrapper) with these exact fields:\n' +
  '{\n' +
  '  "pose": one of "sitting", "standing", "lying", "kneeling", "leaning", "crouching", "floating",\n' +
  '  "orientation": one of "front", "three-quarter-left", "profile-left", "back", "profile-right", "three-quarter-right", "top-down",\n' +
  '  "view_position": one of "full-body", "half-body", "close-up",\n' +
  '  "prompt_attributes": a comma-separated string ready to inject into an SDXL prompt\n' +
  '}\n' +
  '\n' +
  'CRITICAL — orientation refers to VIEWER PERSPECTIVE (how YOU see the subject from camera POV):\n' +
  '- "profile-left" = subject\'s head/body is turned, you see their LEFT cheek/side (face points to the LEFT side of the image)\n' +
  '- "profile-right" = you see their RIGHT cheek/side (face points to the RIGHT side of the image)\n' +
  '- "three-quarter-left" = mostly facing camera but rotated ~45° so face points slightly to the LEFT side of the image\n' +
  '- "three-quarter-right" = mostly facing camera but rotated ~45° so face points slightly to the RIGHT side of the image\n' +
  '- "front" = subject directly faces camera/viewer\n' +
  '- "back" = subject faces away from camera (you see their back)\n' +
  '\n' +
  'For prompt_attributes, use UNAMBIGUOUS phrasing that SDXL/Juggernaut interprets correctly:\n' +
  '- For "three-quarter-left" → "three-quarter view, head turned towards the left side of the image, body slightly angled left"\n' +
  '- For "profile-left" → "side profile view, looking towards the left side of the image"\n' +
  '- For "three-quarter-right" → "three-quarter view, head turned towards the right side of the image, body slightly angled right"\n' +
  '- For "profile-right" → "side profile view, looking towards the right side of the image"\n' +
  '- For "front" → "facing viewer, frontal pose, looking at camera"\n' +
  '- For "back" → "rear view, back to camera"\n' +
  '\n' +
  'AVOID ambiguous terms like "facing left" alone (SDXL can interpret it both ways).\n' +
  'ALWAYS specify "left/right side of the image" or "left/right of the frame".\n' +
  '\n' +
  'For pose, also include explicit pose hints:\n' +
  '- sitting → "sitting on a chair/bench/etc, [hands description]"\n' +
  '- standing → "standing pose, [body language]"\n' +
  '- lying → "lying down, [position]"\n' +
  '\n' +
  'For view_position, add framing hint:\n' +
  '- full-body → "full body visible from head to toe, wide framing"\n' +
  '- half-body → "waist up, medium framing"\n' +
  '- close-up → "close-up portrait, head and shoulders"\n' +
  '\n' +
  'Example output for a man sitting on a chair, body rotated to show left side:\n' +
  '{"pose":"sitting","orientation":"three-quarter-left","view_position":"full-body","prompt_attributes":"sitting on a chair, three-quarter view, head turned towards the left side of the image, body slightly angled left, hands on lap, full body visible from head to toe, wide framing"}\n' +
  '\n' +
  'Return strictly valid JSON only.'

export async function POST(req: NextRequest) {
  try {
    const { image_url, provider } = await req.json() as {
      image_url: string
      provider?: 'auto' | 'local' | 'cloud'
    }
    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })

    // Téléchargement image (commun aux 2 providers)
    const imgRes = await fetch(image_url)
    if (!imgRes.ok) return NextResponse.json({ error: `Image inaccessible (${imgRes.status})` }, { status: 400 })
    const buffer = Buffer.from(await imgRes.arrayBuffer())
    const base64 = buffer.toString('base64')
    const contentType = imgRes.headers.get('content-type') ?? 'image/png'
    const mediaType = (
      contentType.includes('jpeg') || contentType.includes('jpg') ? 'image/jpeg' :
      contentType.includes('webp') ? 'image/webp' :
      'image/png'
    ) as 'image/png' | 'image/jpeg' | 'image/webp'

    const requested = provider ?? (process.env.ANALYZE_POSE_PROVIDER as 'local' | 'cloud' | undefined) ?? 'auto'

    // Décide quel provider utiliser
    let useLocal = requested === 'local' || requested === 'auto'
    if (useLocal && requested === 'auto') {
      // Auto-détection : si Ollama down, fallback cloud
      const ollamaUp = await isOllamaAvailable()
      if (!ollamaUp) useLocal = false
    }

    if (useLocal) {
      try {
        const result = await ollamaVisionJSON<PoseAnalysis>({
          system: 'You are a vision analysis assistant. Always respond with valid JSON only, no markdown wrapping.',
          prompt: ANALYSIS_INSTRUCTION,
          images: [base64],
          temperature: 0.1,
          // 90s : couvre le 1er chargement modèle (~60s pour Qwen VL 3B en VRAM)
          // + temps inférence (~3-5s sur runs suivants).
          timeoutMs: 90_000,
        })
        if (!result.pose || !result.orientation || !result.view_position || !result.prompt_attributes) {
          throw new Error('Missing required fields in Qwen VL response')
        }
        return NextResponse.json({ ...result, provider: 'local' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Si requested='local' strict, on remonte l'erreur
        if (requested === 'local') {
          return NextResponse.json({ error: `Local VLM failed: ${msg}` }, { status: 502 })
        }
        // Sinon (auto), fallback cloud avec log VISIBLE pour debug
        console.error('[analyze-pose] Local VLM failed, falling back to Claude Vision. Reason:', msg)
      }
    }

    // ── Fallback / cloud explicite : Claude Haiku Vision ──
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: ANALYSIS_INSTRUCTION },
        ],
      }],
    })
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    if (!text) return NextResponse.json({ error: 'Vision analysis empty (Claude)' }, { status: 502 })

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: `Invalid JSON: ${text.slice(0, 200)}` }, { status: 502 })

    let parsed: PoseAnalysis
    try {
      parsed = JSON.parse(jsonMatch[0]) as PoseAnalysis
    } catch (e) {
      return NextResponse.json({ error: `JSON parse failed: ${(e as Error).message}` }, { status: 502 })
    }

    if (!parsed.pose || !parsed.orientation || !parsed.view_position || !parsed.prompt_attributes) {
      return NextResponse.json({ error: 'Missing required fields in Claude response', raw: text.slice(0, 300) }, { status: 502 })
    }

    return NextResponse.json({ ...parsed, provider: 'cloud' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[analyze-pose] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
