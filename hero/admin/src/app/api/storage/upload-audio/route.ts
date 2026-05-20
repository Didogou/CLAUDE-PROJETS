import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30
export const runtime = 'nodejs'

/**
 * POST /api/storage/upload-audio
 *
 * Upload un fichier audio (data URL base64) dans le bucket Supabase `audio`
 * (le même que /api/elevenlabs/tts) et retourne son URL publique.
 *
 * Body : { data_url, path? }
 *   - `data_url` (req) : "data:audio/mpeg;base64,..." (mp3) ou wav, ogg, m4a
 *   - `path` (opt)     : chemin relatif dans le bucket. Défaut : "temp/audio_{ts}.{ext}"
 *
 * Retour : { url } (URL publique Supabase)
 *
 * Usage typique : test LTX 2.3 lipsync — l'auteur uploade un mp3 manuellement
 * pour valider la chaîne avant d'avoir le wiring TTS automatique.
 */
export async function POST(req: NextRequest) {
  try {
    const { data_url, path } = await req.json() as { data_url: string; path?: string }

    if (!data_url || !data_url.startsWith('data:audio/')) {
      return NextResponse.json(
        { error: 'data_url manquant ou format invalide (attendu: data:audio/...;base64,...)' },
        { status: 400 },
      )
    }

    // Parse data URL: data:audio/mpeg;base64,SUQzAA...
    const match = data_url.match(/^data:audio\/([\w+-]+);base64,(.+)$/)
    if (!match) {
      return NextResponse.json({ error: 'data_url audio malformé' }, { status: 400 })
    }
    const subtype = match[1].toLowerCase()  // mpeg, wav, ogg, mp4, x-m4a, webm…
    const base64Data = match[2]
    const buffer = Buffer.from(base64Data, 'base64')

    // Mapping subtype → extension fichier (LoadAudio ComfyUI lit l'extension)
    const extMap: Record<string, string> = {
      mpeg: 'mp3',
      mp3: 'mp3',
      wav: 'wav',
      'x-wav': 'wav',
      ogg: 'ogg',
      mp4: 'm4a',
      'x-m4a': 'm4a',
      webm: 'webm',
      flac: 'flac',
    }
    const ext = extMap[subtype] ?? subtype
    const contentType = `audio/${subtype}`
    const finalPath = path ?? `temp/audio_${Date.now()}.${ext}`

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { error: uploadError } = await supabase.storage
      .from('audio')
      .upload(finalPath, buffer, { contentType, upsert: true })

    if (uploadError) {
      throw new Error(`Supabase upload: ${uploadError.message}`)
    }

    const { data: { publicUrl } } = supabase.storage.from('audio').getPublicUrl(finalPath)

    return NextResponse.json({ url: publicUrl })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[storage/upload-audio]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
