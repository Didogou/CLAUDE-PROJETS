import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { translateToEnglish } from '@/lib/ai-utils'
import https from 'node:https'

export const maxDuration = 300

type Provider = 'replicate' | 'leonardo'

const STYLE_SUFFIXES: Record<string, string> = {
  realistic:   'detailed digital painting, cinematic lighting, rich colors, professional illustration',
  manga:       'manga art style, black and white screentones, expressive linework, Japanese comic book style',
  bnw:         'black and white ink illustration, crosshatching, ink wash, monochromatic, high contrast',
  watercolor:  'watercolor illustration, soft edges, transparent washes, delicate colors, painterly',
  comic:       'franco-belgian comic book style, clear line, bold colors, Hergé style, bande dessinée',
  dark_fantasy:'dark fantasy art, Frank Frazetta style, dramatic shadows, gritty, highly detailed oil painting',
  pixel:       'pixel art, 16-bit retro game style, limited color palette, crisp pixels',
}

const LEONARDO_MODELS: Record<string, { modelId: string; presetStyle: string }> = {
  realistic:   { modelId: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', presetStyle: 'DYNAMIC' },
  manga:       { modelId: 'e71a1c2f-4f80-4800-934f-2c68979d8cc8', presetStyle: 'ILLUSTRATION' },
  bnw:         { modelId: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', presetStyle: 'ILLUSTRATION' },
  watercolor:  { modelId: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', presetStyle: 'ILLUSTRATION' },
  comic:       { modelId: 'e71a1c2f-4f80-4800-934f-2c68979d8cc8', presetStyle: 'ILLUSTRATION' },
  dark_fantasy:{ modelId: 'aa77f04e-3eec-4034-9c07-d0f619684628', presetStyle: 'ILLUSTRATION' },
  pixel:       { modelId: '1dd50843-d653-4516-a8e3-f0238ee453ff', presetStyle: 'ILLUSTRATION' },
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function apiRequest(hostname: string, path: string, method: 'GET' | 'POST', authHeader: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined
    const req = https.request(
      {
        hostname,
        path,
        method,
        timeout: 65_000,
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

// ── Image generators ───────────────────────────────────────────────────────

async function generateImageReplicate(token: string, prompt: string): Promise<string> {
  const prediction = await apiRequest(
    'api.replicate.com',
    '/v1/models/black-forest-labs/flux-schnell/predictions',
    'POST',
    `Bearer ${token}`,
    { input: { prompt, num_outputs: 1, aspect_ratio: '16:9', output_format: 'webp', output_quality: 85 } }
  )
  if (prediction.error) throw new Error(prediction.error)

  const start = Date.now()
  while (Date.now() - start < 240_000) {
    await new Promise(r => setTimeout(r, 2000))
    const pred = await apiRequest('api.replicate.com', `/v1/predictions/${prediction.id}`, 'GET', `Bearer ${token}`)
    if (pred.status === 'succeeded') {
      const url = Array.isArray(pred.output) ? pred.output[0] : pred.output
      if (!url) throw new Error('Aucune image retournée')
      return url
    }
    if (pred.status === 'failed' || pred.status === 'canceled') throw new Error(pred.error ?? pred.status)
  }
  throw new Error('Délai Replicate dépassé')
}

async function generateImageLeonardo(apiKey: string, prompt: string, style: string): Promise<string> {
  const { modelId, presetStyle } = LEONARDO_MODELS[style] ?? LEONARDO_MODELS.realistic

  const result = await apiRequest(
    'cloud.leonardo.ai',
    '/api/rest/v1/generations',
    'POST',
    `Bearer ${apiKey}`,
    {
      modelId, prompt,
      width: 1360, height: 768,
      num_images: 1, presetStyle, alchemy: true,
      negative_prompt: 'text, watermark, signature, blurry, low quality, deformed',
    }
  )
  const generationId = result?.sdGenerationJob?.generationId
  if (!generationId) throw new Error(`Leonardo: réponse inattendue — ${JSON.stringify(result).slice(0, 200)}`)

  const start = Date.now()
  while (Date.now() - start < 240_000) {
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

// ── SSE route ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: bookId } = await params
  const provider: Provider = (req.nextUrl.searchParams.get('provider') ?? process.env.IMAGE_PROVIDER ?? 'replicate') as Provider

  const replicateToken = process.env.REPLICATE_API_TOKEN
  const leonardoKey    = process.env.LEONARDO_API_KEY

  const encoder = new TextEncoder()
  const send = (controller: ReadableStreamDefaultController, data: object) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (provider === 'replicate' && !replicateToken) {
          send(controller, { type: 'error', message: 'REPLICATE_API_TOKEN non configuré' })
          controller.close(); return
        }
        if (provider === 'leonardo' && !leonardoKey) {
          send(controller, { type: 'error', message: 'LEONARDO_API_KEY non configuré' })
          controller.close(); return
        }

        const { data: book } = await supabaseAdmin
          .from('books').select('theme, illustration_style, illustration_bible').eq('id', bookId).single()
        const { data: sections } = await supabaseAdmin
          .from('sections')
          .select('id, number, summary, content')
          .eq('book_id', bookId)
          .is('image_url', null)
          .order('number')

        const todo = sections ?? []
        const total = todo.length
        const style = (book as any)?.illustration_style ?? 'realistic'
        const bibleFr: string = (book as any)?.illustration_bible?.trim() ?? ''
        const bibleEn = bibleFr ? await translateToEnglish(bibleFr) : ''

        if (total === 0) {
          send(controller, { type: 'done', message: 'Toutes les sections ont déjà une illustration.' })
          controller.close(); return
        }

        send(controller, { type: 'start', total, provider })

        for (let i = 0; i < todo.length; i++) {
          const section = todo[i]
          send(controller, { type: 'progress', current: i + 1, total, sectionNumber: section.number, status: 'generating' })

          try {
            const styleTag = bibleEn || (STYLE_SUFFIXES[style] ?? STYLE_SUFFIXES.realistic)
            const prompt = `Scene illustration. ${section.summary || section.content?.slice(0, 200) || ''}. Theme: ${book?.theme ?? ''}. Atmospheric, narrative book illustration, no text. ${styleTag}`

            let imageUrl: string
            if (provider === 'leonardo') {
              imageUrl = await generateImageLeonardo(leonardoKey!, prompt, style)
            } else {
              imageUrl = await generateImageReplicate(replicateToken!, prompt)
            }

            // Upload vers Supabase Storage
            try {
              const imgRes = await fetch(imageUrl)
              if (imgRes.ok) {
                const buffer = await imgRes.arrayBuffer()
                const contentType = imgRes.headers.get('content-type') ?? 'image/webp'
                const ext = contentType.includes('png') ? 'png' : contentType.includes('jpeg') ? 'jpg' : 'webp'
                const storagePath = `books/${bookId}/sections/${section.id}.${ext}`
                const { error: upErr } = await supabaseAdmin.storage.from('images').upload(storagePath, buffer, { contentType, upsert: true })
                if (!upErr) {
                  const { data: { publicUrl } } = supabaseAdmin.storage.from('images').getPublicUrl(storagePath)
                  imageUrl = publicUrl
                }
              }
            } catch { /* garde l'URL externe si upload échoue */ }

            await supabaseAdmin.from('sections').update({ image_url: imageUrl }).eq('id', section.id)
            send(controller, { type: 'progress', current: i + 1, total, sectionNumber: section.number, status: 'done', imageUrl })
          } catch (err: any) {
            send(controller, { type: 'progress', current: i + 1, total, sectionNumber: section.number, status: 'error', message: err.message })
          }
        }

        send(controller, { type: 'done', total })
      } catch (err: any) {
        send(controller, { type: 'error', message: err.message })
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
