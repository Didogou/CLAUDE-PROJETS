import { NextRequest, NextResponse } from 'next/server'
import https from 'node:https'
import { translateToEnglish } from '@/lib/ai-utils'

export const maxDuration = 60

type ImageType = 'cover' | 'section' | 'npc' | 'intro' | 'item'
type Provider = 'replicate' | 'leonardo'
type ReplicateModel = 'flux-schnell' | 'flux-dev' | 'flux-kontext-dev' | 'flux-kontext-pro' | 'ideogram-character' | 'gen4-image' | 'gen4-image-turbo'

// ── Style suffixes (Replicate) ─────────────────────────────────────────────

const STYLE_SUFFIXES: Record<string, string> = {
  realistic:    'detailed digital painting, cinematic lighting, rich colors, professional illustration',
  photo:        'cinematic photography, photorealistic, 35mm film, dramatic lighting, shot on Sony A7, film grain',
  manga:        'manga art style, black and white screentones, expressive linework, Japanese comic book style',
  bnw:          'black and white ink illustration, crosshatching, ink wash, monochromatic, high contrast',
  watercolor:   'watercolor illustration, soft edges, transparent washes, delicate colors, painterly',
  comic:        'franco-belgian comic book style, clear line, bold colors, Hergé style, bande dessinée',
  dark_fantasy: 'dark fantasy art, Frank Frazetta style, dramatic shadows, gritty, highly detailed oil painting',
  pixel:        'pixel art, 16-bit retro game style, limited color palette, crisp pixels',
  sketch:       'pencil sketch illustration, rough hand-drawn pencil lines, graphite strokes, loose linework, construction lines visible, no color fill, white paper background, storyboard concept art style',
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

function clean(s: string): string {
  // Supprime les espaces multiples, points doubles, points orphelins
  return s.replace(/\.\.+/g, '.').replace(/\.\s+\./g, '.').replace(/\s{2,}/g, ' ').trim()
}

function buildPrompt(type: ImageType, data: Record<string, string>): { prompt: string; aspect_ratio: string } {
  // La bible visuelle s'ajoute AU style suffix (ne le remplace plus)
  const baseStyle = STYLE_SUFFIXES[data.style] ?? STYLE_SUFFIXES.realistic
  const styleSuffix = data.illustration_bible?.trim()
    ? `${baseStyle}, ${data.illustration_bible.trim()}`
    : baseStyle

  switch (type) {
    case 'cover': {
      const synopsis = data.description?.trim().slice(0, 500) || ''
      const protagonist = data.protagonist?.trim() ? `The main character is visible: ${data.protagonist.trim()}.` : ''
      return {
        prompt: clean(`Mobile game app icon artwork. ${data.theme} theme. ${synopsis} ${protagonist} Dramatic key art, cinematic composition, heroic fantasy video game cover style, rich atmosphere, no text, no letters, no title, no UI elements, no watermark. ${styleSuffix}`),
        aspect_ratio: '1:1',
      }
    }
    case 'section': {
      const protagonist = data.protagonist?.trim() ? `The main character appears: ${data.protagonist.trim()}.` : ''
      // NPC appearances : exclure le perso de référence Kontext (déjà dans l'image)
      const kontextName = data.kontext_ref_name?.trim().toLowerCase()
      const npcParts = (data.npc_appearances ?? '').split('|').map(s => s.trim()).filter(s => {
        if (!s) return false
        if (kontextName && s.toLowerCase().includes(kontextName)) return false
        return true
      })
      const npcContext = npcParts.length > 0 ? `Supporting characters: ${npcParts.join(' | ')}.` : ''
      const kontextRef = kontextName ? `Keep the character named ${data.kontext_ref_name.trim()} visually consistent with the reference image.` : ''
      const SCENE_INTROS: Record<string, string> = {
        sketch:      'Pencil sketch scene.',
        bnw:         'Black and white illustration.',
        manga:       'Manga panel.',
        comic:       'Comic book panel.',
        watercolor:  'Watercolor scene.',
        pixel:       'Pixel art scene.',
        dark_fantasy:'Dark fantasy scene.',
        photo:       'Photographic scene.',
        realistic:   'Cinematic scene.',
      }
      const sceneIntro = SCENE_INTROS[data.style] ?? 'Cinematic scene.'
      const lighting = data.style === 'sketch' || data.style === 'bnw'
        ? 'strong contrast, clear linework, no flat areas,'
        : data.style === 'dark_fantasy'
          ? 'dynamic lighting with visible details, dramatic shadows,'
          : 'dynamic lighting with visible details, ambient fill light,'
      const themeTag = data.style === 'dark_fantasy' ? '' : `Theme: ${data.theme}.`
      return {
        prompt: clean(`${sceneIntro} ${data.summary || data.content?.slice(0, 200) || ''}. ${protagonist} ${npcContext} ${kontextRef} ${themeTag} Rich environmental background, ${lighting} no plain background, no studio backdrop, no text, no letters, no writing, no typography, no words, no signs, no readable text anywhere in the image. ${styleSuffix}`),
        aspect_ratio: data.aspect_ratio ?? '16:9',
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
    case 'item': {
      const desc = data.description?.trim() || data.name?.trim() || ''
      return {
        prompt: `Isolated fantasy item on a plain dark background. ${desc}. Close-up product shot, game inventory icon style, dramatic lighting, intricate detail, no text, no watermark. ${styleSuffix}`,
        aspect_ratio: '1:1',
      }
    }
    case 'intro': {
      const baseStyle2 = STYLE_SUFFIXES[data.style] ?? STYLE_SUFFIXES.realistic
      const styleSuffix2 = data.illustration_bible?.trim()
        ? `${baseStyle2}, ${data.illustration_bible.trim()}`
        : baseStyle2
      return {
        prompt: clean(`${data.prompt_en}. Cinematic storyboard frame, well-lit scene, visible character details, strong ambient fill light, no pitch-black areas, no text, no watermark. ${styleSuffix2}`),
        aspect_ratio: '16:9',
      }
    }
  }
}

function aspectToDimensions(aspect_ratio: string): { width: number; height: number } {
  return aspect_ratio === '16:9' ? { width: 1360, height: 768 } : { width: 1024, height: 1024 }
}

// Gen4 only supports a subset of aspect ratios
function mapAspectRatioForGen4(ar: string): string {
  const supported = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9']
  if (supported.includes(ar)) return ar
  if (ar === '2:3') return '3:4'
  if (ar === '3:2') return '4:3'
  return '16:9'
}

// Sanitize a character name to a valid Gen-4 reference tag
// Rules: alphanumeric, 3–15 chars, starts with a letter
function sanitizeGen4Tag(name: string): string {
  let clean = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!clean || !/^[a-z]/.test(clean)) clean = 'c' + clean
  return clean.slice(0, 15).padEnd(3, 'x')
}

// Inject @tags into prompt by replacing character names
function injectGen4Tags(prompt: string, refs: Array<{ name: string; tag: string }>): string {
  let result = prompt
  for (const { name, tag } of refs) {
    result = result.replace(new RegExp(`\\b${name}\\b`, 'gi'), `@${tag}`)
  }
  return result
}

// Map our style key to Ideogram style_type
function toIdeogramStyle(style: string): string {
  if (style === 'realistic' || style === 'photo') return 'Realistic'
  return 'Auto'
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
    const { type, data, provider: reqProvider, input_image_url, preview, model: reqModel, gen4_refs } = await req.json() as {
      type: ImageType; data: Record<string, string>; provider?: Provider; input_image_url?: string; preview?: boolean; model?: ReplicateModel; gen4_refs?: Array<{ url: string; name: string }>
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
      if (data.theme) {
        const THEME_MAP: Record<string, string> = { 'contemporain': 'Contemporary', 'fantastique': 'Fantasy', 'science-fiction': 'Science Fiction', 'historique': 'Historical', 'horreur': 'Horror', 'policier': 'Crime thriller', 'aventure': 'Adventure', 'western': 'Western', 'cyberpunk': 'Cyberpunk', 'steampunk': 'Steampunk' }
        translatedData.theme = THEME_MAP[data.theme.toLowerCase().trim()] ?? await translateToEnglish(data.theme)
      }
      if (data.npc_appearances) translatedData.npc_appearances = await translateToEnglish(data.npc_appearances)
    } else if (type === 'npc') {
      translatedData.description = await translateToEnglish(data.description ?? '')
    } else if (type === 'item') {
      translatedData.description = await translateToEnglish(data.description ?? '')
      if (data.name) translatedData.name = await translateToEnglish(data.name)
    } else if (type === 'intro') {
      // Traduire prompt_en (ou prompt_fr en fallback si prompt_en vide)
      const rawPrompt = data.prompt_en?.trim() || data.prompt_fr?.trim() || ''
      translatedData.prompt_en = await translateToEnglish(rawPrompt)
    }

    const { prompt, aspect_ratio } = buildPrompt(type, translatedData)
    const style = data.style ?? 'realistic'

    // Résoudre le modèle Replicate effectif
    const resolvedModel: ReplicateModel = reqModel ?? (input_image_url ? 'flux-kontext-dev' : 'flux-schnell')

    // Mode prévisualisation : retourner le prompt sans générer
    if (preview) return NextResponse.json({ prompt, aspect_ratio, model: resolvedModel })

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

    let predInput: object
    let predPath: string

    if (resolvedModel === 'flux-kontext-pro') {
      predPath = '/v1/models/black-forest-labs/flux-kontext-pro/predictions'
      predInput = { prompt, aspect_ratio, output_format: 'jpg', output_quality: 90, ...(input_image_url ? { input_image: input_image_url } : {}) }

    } else if (resolvedModel === 'ideogram-character') {
      if (!input_image_url) throw new Error('Ideogram Character requiert une image de référence')
      predPath = '/v1/models/ideogram-ai/ideogram-character/predictions'
      predInput = { prompt, character_reference_image: input_image_url, aspect_ratio, style_type: toIdeogramStyle(style), rendering_speed: 'Quality' }

    } else if (resolvedModel === 'gen4-image' || resolvedModel === 'gen4-image-turbo') {
      const modelName = resolvedModel === 'gen4-image-turbo' ? 'gen4-image-turbo' : 'gen4-image'
      predPath = `/v1/models/runwayml/${modelName}/predictions`
      const gen4Ar = mapAspectRatioForGen4(aspect_ratio)
      // Build reference images + tags from gen4_refs
      const refs = (gen4_refs ?? []).filter(r => r.url && r.name).slice(0, 3)
      const refTagMap = refs.map(r => ({ name: r.name, tag: sanitizeGen4Tag(r.name), url: r.url }))
      const taggedPrompt = refTagMap.length > 0 ? injectGen4Tags(prompt, refTagMap) : prompt
      const reference_images = refTagMap.map(r => r.url)
      const reference_tags = refTagMap.map(r => r.tag)
      predInput = {
        prompt: taggedPrompt,
        aspect_ratio: gen4Ar,
        resolution: '1080p',
        ...(reference_images.length > 0 ? { reference_images, reference_tags } : {}),
      }

    } else if (resolvedModel === 'flux-kontext-dev') {
      predPath = '/v1/models/black-forest-labs/flux-kontext-dev/predictions'
      predInput = { prompt, aspect_ratio, output_format: 'webp', output_quality: 85, ...(input_image_url ? { input_image: input_image_url } : {}) }

    } else if (resolvedModel === 'flux-dev') {
      predPath = '/v1/models/black-forest-labs/flux-dev/predictions'
      predInput = { prompt, num_outputs: 1, aspect_ratio, output_format: 'jpg', output_quality: 90, guidance: 3.5 }

    } else {
      // flux-schnell (default)
      predPath = '/v1/models/black-forest-labs/flux-schnell/predictions'
      predInput = { prompt, num_outputs: 1, aspect_ratio, output_format: 'webp', output_quality: 85 }
    }

    const meta = { prompt_used: prompt, model_used: resolvedModel, aspect_ratio_used: aspect_ratio, style_used: style }

    const prediction = await replicateRequest(predPath, 'POST', token, { input: predInput }, { 'Prefer': 'wait=55' })
    console.log(`[generate-image] ${resolvedModel} response status:`, prediction.status)
    if (prediction.error) throw new Error(prediction.error)
    if (prediction.detail) throw new Error(prediction.detail)

    if (prediction.status === 'succeeded') {
      const image_url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
      return NextResponse.json({ image_url, ...meta })
    }

    if (!prediction.id) throw new Error(`Réponse inattendue (${resolvedModel}) : ${JSON.stringify(prediction).slice(0, 200)}`)
    return NextResponse.json({ prediction_id: prediction.id, provider: 'replicate', ...meta })

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
