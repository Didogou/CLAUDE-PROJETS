import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'
import { ollamaVisionJSON, isOllamaAvailable } from '@/lib/ollama'

export const maxDuration = 90

/**
 * POST /api/analyze-character
 *
 * Body : { image_url: string, provider?: 'auto' | 'local' | 'cloud' }
 *
 * Analyse l'image d'un personnage (la "ref" dans le pipeline character swap)
 * et extrait les attributs visuels que IPAdapter Plus / FaceID transfèrent
 * MAL : couleur de cheveux, couleur des yeux, ethnie / race fantasy, traits
 * distinctifs (oreilles d'elfe, cicatrice, tatouage), tranche d'âge.
 *
 * Le résultat (`suggested_tags`) s'injecte au début du prompt body swap :
 * "long blonde hair, blue eyes, fair skin, elf with pointed ears, young woman"
 * → le KSampler génère explicitement ces attributs même si IPAdapter ne les
 * transfère pas via les embeddings CLIP Vision.
 *
 * Providers :
 *   - 'local' : Qwen 2.5 VL 3B via Ollama (gratuit, local, SaaS-friendly)
 *   - 'cloud' : Claude Haiku 4.5 Vision (Anthropic, payant ~$0.001/appel)
 *   - 'auto' (default) : essaie 'local' d'abord, fallback 'cloud' si Ollama down
 *
 * Retour :
 * {
 *   hair: string,            // ex: "long flowing blonde hair, braided crown"
 *   eyes: string,            // ex: "blue eyes" or "unknown"
 *   skin: string,            // ex: "fair skin" or "tan complexion"
 *   ethnicity_features: string, // ex: "elf, pointed ears" or "human"
 *   age_appearance: string,  // ex: "young woman", "middle-aged man", "child"
 *   clothing_style: string,  // ex: "medieval green dress with white sleeves"
 *   suggested_tags: string,  // tous les attributs en virgule (à injecter prompt)
 *   provider: 'local' | 'cloud'
 * }
 */

interface CharacterAnalysis {
  hair: string
  eyes: string
  skin: string
  ethnicity_features: string
  age_appearance: string
  clothing_style: string
  suggested_tags: string
}

const ANALYSIS_INSTRUCTION =
  'Analyze the character in this image (the main subject — person, humanoid, anthropomorphic creature). ' +
  'Output ONLY a JSON object (no preamble, no markdown wrapper) with these exact fields:\n' +
  '{\n' +
  '  "hair": short description of hair (color + length + style). Ex: "long flowing blonde hair, loose waves" or "short black hair, military cut" or "bald" or "no visible hair (hooded)",\n' +
  '  "eyes": eye color if visible. Ex: "blue eyes" or "brown eyes" or "unknown" if not visible,\n' +
  '  "skin": skin tone. Ex: "fair skin" or "tan complexion" or "dark skin",\n' +
  '  "ethnicity_features": race / species / distinctive anatomical features. Ex: "human" or "elf with pointed ears" or "orc with green skin and tusks" or "young human female" — be SPECIFIC about fantasy races if visible (elf ears, dwarf beard, etc.),\n' +
  '  "age_appearance": apparent age category. One of: "child", "teenager", "young adult", "adult", "middle-aged", "elderly",\n' +
  '  "clothing_style": brief description of clothing/armor visible. Ex: "medieval green dress with white sleeves" or "leather armor with metal pauldrons",\n' +
  '  "suggested_tags": ALL the above concatenated as a comma-separated string ready to inject at the START of an SDXL prompt. Include ONLY the attributes that IPAdapter typically misses (hair color, eye color, ethnicity_features, age_appearance) — NOT the clothing (IPAdapter handles that). Ex: "long flowing blonde hair, blue eyes, fair skin, elf with pointed ears, young adult woman"\n' +
  '}\n' +
  '\n' +
  'CRITICAL :\n' +
  '- Be CONCISE — short noun phrases, no full sentences.\n' +
  '- Use UNAMBIGUOUS terms that SDXL/Juggernaut interprets correctly.\n' +
  '- For "suggested_tags", focus on attributes IPAdapter MISSES : hair color/style, eye color, race/species, age. Skip clothing (IPAdapter transfers it via image).\n' +
  '- If unsure about a field, use "unknown" rather than inventing.\n' +
  '\n' +
  'Example output for a young blonde elf woman in green medieval dress :\n' +
  '{"hair":"long flowing blonde hair, loose waves","eyes":"blue eyes","skin":"fair skin","ethnicity_features":"elf with pointed ears","age_appearance":"young adult","clothing_style":"medieval green dress with white sleeves","suggested_tags":"long flowing blonde hair, blue eyes, fair skin, elf with pointed ears, young adult woman"}\n' +
  '\n' +
  'Return strictly valid JSON only.'

export async function POST(req: NextRequest) {
  try {
    const { image_url, provider } = await req.json() as {
      image_url: string
      provider?: 'auto' | 'local' | 'cloud'
    }
    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })

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

    const requested = provider ?? (process.env.ANALYZE_CHARACTER_PROVIDER as 'local' | 'cloud' | undefined) ?? 'auto'

    let useLocal = requested === 'local' || requested === 'auto'
    if (useLocal && requested === 'auto') {
      const ollamaUp = await isOllamaAvailable()
      if (!ollamaUp) useLocal = false
    }

    if (useLocal) {
      try {
        const result = await ollamaVisionJSON<CharacterAnalysis>({
          system: 'You are a vision analysis assistant. Always respond with valid JSON only, no markdown wrapping.',
          prompt: ANALYSIS_INSTRUCTION,
          images: [base64],
          temperature: 0.1,
          timeoutMs: 90_000,
        })
        const required: Array<keyof CharacterAnalysis> = ['hair', 'eyes', 'skin', 'ethnicity_features', 'age_appearance', 'clothing_style', 'suggested_tags']
        for (const field of required) {
          if (!result[field]) throw new Error(`Missing required field: ${field}`)
        }
        return NextResponse.json({ ...result, provider: 'local' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (requested === 'local') {
          return NextResponse.json({ error: `Local VLM failed: ${msg}` }, { status: 502 })
        }
        console.error('[analyze-character] Local VLM failed, falling back to Claude Vision. Reason:', msg)
      }
    }

    // ── Fallback / cloud : Claude Haiku Vision ──
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
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

    let parsed: CharacterAnalysis
    try {
      parsed = JSON.parse(jsonMatch[0]) as CharacterAnalysis
    } catch (e) {
      return NextResponse.json({ error: `JSON parse failed: ${(e as Error).message}` }, { status: 502 })
    }

    const required: Array<keyof CharacterAnalysis> = ['hair', 'eyes', 'skin', 'ethnicity_features', 'age_appearance', 'clothing_style', 'suggested_tags']
    for (const field of required) {
      if (!parsed[field]) {
        return NextResponse.json({ error: `Missing required field: ${field}`, raw: text.slice(0, 300) }, { status: 502 })
      }
    }

    return NextResponse.json({ ...parsed, provider: 'cloud' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[analyze-character] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
