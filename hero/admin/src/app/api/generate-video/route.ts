import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 120

const VEO_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const VEO_MODEL = process.env.VEO_MODEL ?? 'veo-3.0-fast-generate-001'

// ── POST — créer le job Veo ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { prompt, duration = 5 } = await req.json() as {
      prompt: string
      duration?: number
    }

    if (!prompt) return NextResponse.json({ error: 'prompt requis' }, { status: 400 })

    const apiKey = process.env.GOOGLE_AI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'GOOGLE_AI_API_KEY non configuré' }, { status: 500 })

    const res = await fetch(
      `${VEO_BASE}/models/${VEO_MODEL}:predictLongRunning?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { aspectRatio: '16:9', sampleCount: 1 },
        }),
      }
    )

    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message ?? `Veo error ${res.status}`)

    const operationName = data.name
    if (!operationName) throw new Error(`Réponse Veo inattendue : ${JSON.stringify(data).slice(0, 200)}`)

    console.log('[generate-video] Veo operation:', operationName)
    return NextResponse.json({ operation_name: operationName })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── GET — polling + upload Supabase quand terminé ─────────────────────────

export async function GET(req: NextRequest) {
  const op = req.nextUrl.searchParams.get('op')
  const storagePath = req.nextUrl.searchParams.get('path') // ex: books/123/intro/frame-abc/video

  if (!op) return NextResponse.json({ error: 'op requis' }, { status: 400 })

  try {
    const apiKey = process.env.GOOGLE_AI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'GOOGLE_AI_API_KEY non configuré' }, { status: 500 })

    const res = await fetch(`${VEO_BASE}/${op}?key=${apiKey}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message ?? `Veo poll error ${res.status}`)

    if (!data.done) return NextResponse.json({ status: 'processing' })

    // Veo a terminé — récupérer l'URI vidéo
    const veoUri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    if (!veoUri) {
      const err = data.error?.message ?? 'Aucune vidéo générée'
      return NextResponse.json({ status: 'failed', error: err })
    }

    // Si pas de storagePath, retourner l'URI brute (temporaire)
    if (!storagePath) {
      return NextResponse.json({ status: 'succeeded', veo_uri: veoUri })
    }

    // Télécharger la vidéo depuis Veo (nécessite l'API key)
    const videoRes = await fetch(`${veoUri}?key=${apiKey}`)
    if (!videoRes.ok) throw new Error(`Erreur téléchargement vidéo Veo : ${videoRes.status}`)

    const buffer = await videoRes.arrayBuffer()
    const contentType = videoRes.headers.get('content-type') ?? 'video/mp4'
    const finalPath = `${storagePath}.mp4`

    // Upload dans Supabase Storage (bucket "images")
    const { error: uploadError } = await supabaseAdmin.storage
      .from('images')
      .upload(finalPath, buffer, { contentType, upsert: true })

    if (uploadError) throw new Error(`Erreur upload Supabase : ${uploadError.message}`)

    const { data: { publicUrl } } = supabaseAdmin.storage.from('images').getPublicUrl(finalPath)

    return NextResponse.json({ status: 'succeeded', video_url: publicUrl })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
