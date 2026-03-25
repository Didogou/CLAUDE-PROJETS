import { NextRequest, NextResponse } from 'next/server'
import https from 'node:https'
import { translateToEnglish } from '@/lib/ai-utils'

export const maxDuration = 60

type ImageType = 'cover' | 'section' | 'npc' | 'intro'
type Provider = 'replicate' | 'leonardo'

// ── Style suffixes (Replicate) ─────────────────────────────────────────────

const STYLE_SUFFIXES: Record<string, string> = {
  realistic:   'detailed digital painting, cinematic lighting, rich colors, professional illustration',
  manga:       'manga art style, black and white screentones, expressive linework, Japanese comic book style',
  bnw:         'black and white ink illustration, crosshatching, ink wash, monochromatic, high contrast',
  watercolor:  'watercolor illustration, soft edges, transparent washes, delicate colors, painterly',
  comic:       'franco-belgian comic book style, clear line, bold colors, Hergé style, bande dessinée',
  dark_fantasy:'dark fantasy art, Frank Frazetta style, dramatic shadows, gritty, highly detailed oil painting',
  pixel:       'pixel art, 16-bit retro game style, limited color palette, crisp pixels',
}

// ── Leonardo model mapping ────────────────────────────────────────────────

const LEONARDO_MODELS: Record<string, { modelId: string; presetStyle: string }> = {
  realistic:   { modelId: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', presetStyle: 'DYNAMIC' },         // Phoenix 1.0
  manga:       { modelId: 'e71a1c2f-4f80-4800-934f-2c68979d8cc8', presetStyle: 'ILLUSTRATION' },     // Anime XL
  bnw:         { modelId: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', presetStyle: 'ILLUSTRATION' },     // Phoenix 1.0
  watercolor:  { modelId: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', presetStyle: 'ILLUSTRATION' },     // Phoenix 1.0
  comic:       { modelId: 'e71a1c2f-4f80-4800-934f-2c68979d8cc8', presetStyle: 'ILLUSTRATION' },     // Anime XL
  dark_fantasy:{ modelId: 'aa77f04e-3eec-4034-9c07-d0f619684628', presetStyle: 'ILLUSTRATION' },     // Kino XL
  pixel:       { modelId: '1dd50843-d653-4516-a8e3-f0238ee453ff', presetStyle: 'ILLUSTRATION' },     // Flux Schnell
}

// ── Prompt builder ─────────────────────────────────────────────────────────

function buildPrompt(type: ImageType, data: Record<string, string>): { prompt: string; aspect_ratio: string } {
  // La bible visuelle remplace les STYLE_SUFFIXES si présente
  const styleSuffix = data.illustration_bible?.trim()
    ? data.illustration_bible.trim()
    : (STYLE_SUFFIXES[data.style] ?? STYLE_SUFFIXES.realistic)

  switch (type) {
    case 'cover': {
      const synopsis = data.description?.trim().slice(0, 500) || ''
      const protagonist = data.protagonist?.trim() ? `The main character is visible: ${data.protagonist.trim()}.` : ''
      return {
        prompt: `Mobile game app icon artwork. ${data.theme} theme. ${synopsis} ${protagonist} Dramatic key art, cinematic composition, heroic fantasy video game cover style, rich atmosphere, no text, no letters, no title, no UI elements, no watermark. ${styleSuffix}`,
        aspect_ratio: '1:1',
      }
    }
    case 'section': {
      const protagonist = data.protagonist?.trim() ? `The main character appears: ${data.protagonist.trim()}.` : ''
      const npcContext = data.npc_appearances?.trim() ? `Characters present: ${data.npc_appearances.trim()}.` : ''
      return {
        prompt: `Scene illustration. ${data.summary || data.content?.slice(0, 200) || ''}. ${protagonist} ${npcContext} Theme: ${data.theme}. Atmospheric, narrative book illustration, no text. ${styleSuffix}`,
        aspect_ratio: '16:9',
      }
    }
    case 'npc': {
      // Si un prompt custom est fourni (déjà traduit en anglais), on l'utilise directement
      if (data.custom_prompt?.trim()) {
        return {
          prompt: `${data.custom_prompt.trim()} No text, no watermark. ${styleSuffix}`,
          aspect_ratio: data.framing ? '2:3' : '1:1',
        }
      }
      const visualDesc = data.appearance?.trim() || data.description?.trim() || ''
      const originCtx = data.origin?.trim() ? `Background: ${data.origin.trim()}.` : ''
      const framingCtx = data.framing?.trim() ? `${data.framing.trim()}.` : 'Detailed face and upper body portrait,'
      return {
        prompt: `Character portrait. ${data.type ?? ''}. ${visualDesc}. ${originCtx} ${framingCtx} ${data.theme}-inspired design, dramatic lighting, no text, no background clutter. ${styleSuffix}`,
        aspect_ratio: data.framing ? '2:3' : '1:1',
      }
    }
    case 'intro': {
      const styleSuffix2 = data.illustration_bible?.trim()
        ? data.illustration_bible.trim()
        : (STYLE_SUFFIXES[data.style] ?? STYLE_SUFFIXES.realistic)
      return {
        prompt: `${data.prompt_en}. Cinematic storyboard frame, no text, no watermark. ${styleSuffix2}`,
        aspect_ratio: '16:9',
      }
    }
  }
}

function aspectToDimensions(aspect_ratio: string): { width: number; height: number } {
  return aspect_ratio === '16:9' ? { width: 1360, height: 768 } : { width: 1024, height: 1024 }
}

// ── Replicate helpers ──────────────────────────────────────────────────────

function replicateRequest(path: string, method: 'GET' | 'POST', token: string, body?: object, extraHeaders?: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined
    const req = https.request(
      {
        hostname: 'api.replicate.com',
        path,
        method,
        timeout: 65_000,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) }
          catch (e) { reject(e) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ── Leonardo helpers ───────────────────────────────────────────────────────

function leonardoRequest(path: string, method: 'GET' | 'POST', apiKey: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined
    const req = https.request(
      {
        hostname: 'cloud.leonardo.ai',
        path: `/api/rest/v1${path}`,
        method,
        timeout: 65_000,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) }
          catch (e) { reject(e) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout Leonardo')) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ── POST — créer la génération ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { type, data, provider: reqProvider, input_image_url } = await req.json() as {
      type: ImageType; data: Record<string, string>; provider?: Provider; input_image_url?: string
    }
    if (!type || !data) return NextResponse.json({ error: 'type et data requis' }, { status: 400 })

    // Traduire les champs texte en anglais si nécessaire
    const translatedData = { ...data }
    if (data.illustration_bible) translatedData.illustration_bible = await translateToEnglish(data.illustration_bible)
    if (type === 'cover') {
      translatedData.description = await translateToEnglish(data.description ?? '')
      if (data.protagonist) translatedData.protagonist = await translateToEnglish(data.protagonist)
    } else if (type === 'section') {
      translatedData.summary = await translateToEnglish(data.summary ?? '')
      if (data.protagonist) translatedData.protagonist = await translateToEnglish(data.protagonist)
    } else if (type === 'npc') {
      translatedData.description = await translateToEnglish(data.description ?? '')
    } else if (type === 'intro') {
      // Traduire prompt_en (ou prompt_fr en fallback si prompt_en vide)
      const rawPrompt = data.prompt_en?.trim() || data.prompt_fr?.trim() || ''
      translatedData.prompt_en = await translateToEnglish(rawPrompt)
    }

    const { prompt, aspect_ratio } = buildPrompt(type, translatedData)
    const style = data.style ?? 'realistic'

    // Choix du provider : explicite > variable d'env > fallback replicate
    const provider: Provider = reqProvider
      ?? (process.env.IMAGE_PROVIDER as Provider | undefined)
      ?? 'replicate'

    // ── Leonardo ───────────────────────────────────────────────────────────
    if (provider === 'leonardo') {
      const apiKey = process.env.LEONARDO_API_KEY
      if (!apiKey) return NextResponse.json({ error: 'LEONARDO_API_KEY non configuré' }, { status: 500 })

      const { modelId, presetStyle } = LEONARDO_MODELS[style] ?? LEONARDO_MODELS.realistic
      const { width, height } = aspectToDimensions(aspect_ratio)

      const result = await leonardoRequest('/generations', 'POST', apiKey, {
        modelId, prompt, width, height, num_images: 1, presetStyle, alchemy: true,
        negative_prompt: 'text, watermark, signature, blurry, low quality, deformed',
      })

      const generationId = result?.sdGenerationJob?.generationId
      if (!generationId) throw new Error(`Leonardo: réponse inattendue — ${JSON.stringify(result).slice(0, 200)}`)

      console.log('[generate-image] Leonardo generationId:', generationId)
      return NextResponse.json({ prediction_id: generationId, provider: 'leonardo' })
    }

    // ── Replicate ──────────────────────────────────────────────────────────
    const token = process.env.REPLICATE_API_TOKEN
    if (!token) return NextResponse.json({ error: 'REPLICATE_API_TOKEN non configuré' }, { status: 500 })

    // ── Kontext (img2img) si une image de référence est fournie ────────────
    if (input_image_url) {
      const prediction = await replicateRequest(
        '/v1/models/black-forest-labs/flux-kontext-dev/predictions',
        'POST',
        token,
        { input: { prompt, input_image: input_image_url, aspect_ratio, output_format: 'webp', output_quality: 85 } },
        { 'Prefer': 'wait=55' }
      )
      console.log('[generate-image] Kontext response status:', prediction.status)
      if (prediction.error) throw new Error(prediction.error)
      if (prediction.detail) throw new Error(prediction.detail)
      if (prediction.status === 'succeeded') {
        const image_url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
        return NextResponse.json({ image_url })
      }
      if (!prediction.id) throw new Error(`Réponse inattendue Kontext : ${JSON.stringify(prediction).slice(0, 200)}`)
      return NextResponse.json({ prediction_id: prediction.id, provider: 'replicate' })
    }

    const prediction = await replicateRequest(
      '/v1/models/black-forest-labs/flux-schnell/predictions',
      'POST',
      token,
      { input: { prompt, num_outputs: 1, aspect_ratio, output_format: 'webp', output_quality: 85 } },
      { 'Prefer': 'wait=55' }
    )

    console.log('[generate-image] Replicate response status:', prediction.status)
    if (prediction.error) throw new Error(prediction.error)
    if (prediction.detail) throw new Error(prediction.detail)

    if (prediction.status === 'succeeded') {
      const image_url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
      return NextResponse.json({ image_url })
    }

    if (!prediction.id) throw new Error(`Réponse inattendue Replicate : ${JSON.stringify(prediction).slice(0, 200)}`)
    return NextResponse.json({ prediction_id: prediction.id, provider: 'replicate' })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── GET — polling ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const provider = (req.nextUrl.searchParams.get('provider') ?? 'replicate') as Provider
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  try {
    // ── Leonardo polling ───────────────────────────────────────────────────
    if (provider === 'leonardo') {
      const apiKey = process.env.LEONARDO_API_KEY
      if (!apiKey) return NextResponse.json({ error: 'LEONARDO_API_KEY non configuré' }, { status: 500 })

      const data = await leonardoRequest(`/generations/${id}`, 'GET', apiKey)
      const job = data?.generations_by_pk
      if (!job) return NextResponse.json({ status: 'processing' })

      if (job.status === 'COMPLETE') {
        const image_url = job.generated_images?.[0]?.url
        if (!image_url) return NextResponse.json({ status: 'failed', error: 'Aucune image retournée' })
        return NextResponse.json({ status: 'succeeded', image_url })
      }
      if (job.status === 'FAILED') {
        return NextResponse.json({ status: 'failed', error: 'Génération Leonardo échouée' })
      }
      return NextResponse.json({ status: 'processing' })
    }

    // ── Replicate polling ──────────────────────────────────────────────────
    const token = process.env.REPLICATE_API_TOKEN
    if (!token) return NextResponse.json({ error: 'REPLICATE_API_TOKEN non configuré' }, { status: 500 })

    const pred = await replicateRequest(`/v1/predictions/${id}`, 'GET', token)
    if (pred.status === 'succeeded') {
      const image_url = Array.isArray(pred.output) ? pred.output[0] : pred.output
      return NextResponse.json({ status: 'succeeded', image_url })
    }
    if (pred.status === 'failed' || pred.status === 'canceled') {
      return NextResponse.json({ status: pred.status, error: pred.error ?? pred.status })
    }
    return NextResponse.json({ status: pred.status })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
