import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import https from 'node:https'

export const maxDuration = 120

type Provider = 'replicate' | 'leonardo'

// ── Prompts par style de carte ─────────────────────────────────────────────

const MAP_PROMPTS: Record<string, string> = {
  subway:  'top-down transit map illustration, stylized subway metro network, colored train lines on dark background, circular station markers, minimalist graphic design, game UI map style, high contrast, no text labels, clean vector aesthetic',
  city:    'top-down city map illustration, aerial urban view, street grid and city blocks, district zones, atmospheric dark fantasy city, detailed cartography, game map style, birds-eye view',
  dungeon: 'top-down dungeon floor plan, fantasy RPG map, stone walls and corridors, multiple chambers and rooms, torchlit atmosphere, classic D&D dungeon map, parchment and stone texture, detailed grid layout',
  forest:  'fantasy overworld map illustration, antique parchment style, hand-drawn cartography, forests mountains rivers lakes, tolkien-style fantasy map, warm sepia and earthy tones, illustrated terrain features, compass rose',
  sea:     'fantasy nautical map, old maritime chart illustration, islands and coastlines, stylized ocean waves, sea monsters, compass rose, aged yellowed parchment, treasure map aesthetic, detailed coastal features',
}

const LEONARDO_MAP_MODELS: Record<string, { modelId: string; presetStyle: string }> = {
  subway:  { modelId: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', presetStyle: 'DYNAMIC' },       // Phoenix 1.0
  city:    { modelId: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', presetStyle: 'DYNAMIC' },       // Phoenix 1.0
  dungeon: { modelId: 'aa77f04e-3eec-4034-9c07-d0f619684628', presetStyle: 'ILLUSTRATION' },   // Kino XL
  forest:  { modelId: 'aa77f04e-3eec-4034-9c07-d0f619684628', presetStyle: 'ILLUSTRATION' },   // Kino XL
  sea:     { modelId: 'aa77f04e-3eec-4034-9c07-d0f619684628', presetStyle: 'ILLUSTRATION' },   // Kino XL
}

// ── HTTP helper ────────────────────────────────────────────────────────────

function apiRequest(hostname: string, path: string, method: 'GET' | 'POST', authHeader: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined
    const req = https.request(
      {
        hostname, path, method, timeout: 65_000,
        headers: {
          'Authorization': authHeader,
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
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ── Générateurs ────────────────────────────────────────────────────────────

async function generateReplicate(token: string, prompt: string): Promise<string> {
  const prediction = await apiRequest(
    'api.replicate.com',
    '/v1/models/black-forest-labs/flux-schnell/predictions',
    'POST',
    `Bearer ${token}`,
    { input: { prompt, num_outputs: 1, aspect_ratio: '16:9', output_format: 'webp', output_quality: 90 } }
  )
  if (prediction.error) throw new Error(prediction.error)

  const start = Date.now()
  while (Date.now() - start < 90_000) {
    await new Promise(r => setTimeout(r, 2000))
    const pred = await apiRequest('api.replicate.com', `/v1/predictions/${prediction.id}`, 'GET', `Bearer ${token}`)
    if (pred.status === 'succeeded') return Array.isArray(pred.output) ? pred.output[0] : pred.output
    if (pred.status === 'failed' || pred.status === 'canceled') throw new Error(pred.error ?? pred.status)
  }
  throw new Error('Délai Replicate dépassé')
}

async function generateLeonardo(apiKey: string, prompt: string, mapStyle: string): Promise<string> {
  const { modelId, presetStyle } = LEONARDO_MAP_MODELS[mapStyle] ?? LEONARDO_MAP_MODELS.forest

  const result = await apiRequest(
    'cloud.leonardo.ai', '/api/rest/v1/generations', 'POST', `Bearer ${apiKey}`,
    {
      modelId, prompt, width: 1360, height: 768,
      num_images: 1, presetStyle, alchemy: true,
      negative_prompt: 'text, watermark, signature, blurry, low quality, photo, realistic, people, characters',
    }
  )
  const generationId = result?.sdGenerationJob?.generationId
  if (!generationId) throw new Error(`Leonardo: ${JSON.stringify(result).slice(0, 200)}`)

  const start = Date.now()
  while (Date.now() - start < 90_000) {
    await new Promise(r => setTimeout(r, 3000))
    const data = await apiRequest('cloud.leonardo.ai', `/api/rest/v1/generations/${generationId}`, 'GET', `Bearer ${apiKey}`)
    const job = data?.generations_by_pk
    if (job?.status === 'COMPLETE') {
      const url = job.generated_images?.[0]?.url
      if (!url) throw new Error('Aucune image retournée')
      return url
    }
    if (job?.status === 'FAILED') throw new Error('Génération Leonardo échouée')
  }
  throw new Error('Délai Leonardo dépassé')
}

// ── POST ────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { provider: reqProvider } = await req.json().catch(() => ({}))

  const { data: book } = await supabaseAdmin.from('books').select('*').eq('id', id).single()
  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })
  if (!book.map_style) return NextResponse.json({ error: 'Ce livre n\'a pas de carte' }, { status: 400 })

  const provider: Provider = reqProvider ?? (process.env.IMAGE_PROVIDER as Provider) ?? 'replicate'
  const mapStyle: string = book.map_style
  const { data: locations } = await supabaseAdmin.from('locations').select('name, icon').eq('book_id', id)

  // Construire le prompt : style de carte + contexte du livre + lieux clés
  const basePrompt = MAP_PROMPTS[mapStyle] ?? MAP_PROMPTS.forest
  const locationHints = locations?.length
    ? ` Key locations include: ${locations.slice(0, 8).map((l: any) => l.name).join(', ')}.`
    : ''
  const prompt = `${basePrompt}. Setting: ${book.title}, ${book.theme}, ${book.context_type}.${locationHints} No text, no labels, no UI elements.`

  try {
    let imageUrl: string

    if (provider === 'leonardo') {
      const apiKey = process.env.LEONARDO_API_KEY
      if (!apiKey) return NextResponse.json({ error: 'LEONARDO_API_KEY non configuré' }, { status: 500 })
      imageUrl = await generateLeonardo(apiKey, prompt, mapStyle)
    } else {
      const token = process.env.REPLICATE_API_TOKEN
      if (!token) return NextResponse.json({ error: 'REPLICATE_API_TOKEN non configuré' }, { status: 500 })
      imageUrl = await generateReplicate(token, prompt)
    }

    await supabaseAdmin.from('books').update({ map_image_url: imageUrl }).eq('id', id)
    return NextResponse.json({ success: true, map_image_url: imageUrl, provider })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
