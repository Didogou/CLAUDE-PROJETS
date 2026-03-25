import { NextRequest, NextResponse } from 'next/server'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 30

const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const {
      voice_id,
      text,
      voice_settings,
      save_path,
      with_timestamps,
    } = await req.json() as {
      voice_id: string
      text: string
      voice_settings?: { stability?: number; style?: number; speed?: number; similarity_boost?: number }
      save_path?: string
      with_timestamps?: boolean
    }

    if (!voice_id || !text) return NextResponse.json({ error: 'voice_id et text requis' }, { status: 400 })

    const hasTag = /\[.+?\]/.test(text)
    const modelId = hasTag ? 'eleven_v3' : 'eleven_multilingual_v2'
    const voiceSettings = {
      stability: voice_settings?.stability ?? 0.5,
      similarityBoost: voice_settings?.similarity_boost ?? 0.75,
      style: voice_settings?.style ?? 0,
      speed: voice_settings?.speed ?? 1,
    }

    // ── Mode timestamps (captions sync) — appel REST direct ──────────────
    if (with_timestamps) {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}/with-timestamps`, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          output_format: 'mp3_44100_128',
          voice_settings: {
            stability: voiceSettings.stability,
            similarity_boost: voiceSettings.similarityBoost,
            style: voiceSettings.style,
          },
        }),
      })
      if (!res.ok) {
        const err = await res.text()
        console.error('[TTS timestamps]', res.status, err)
        throw new Error(`ElevenLabs timestamps: ${res.status} ${err}`)
      }
      const data = await res.json()
      const alignment = data.alignment ?? data.normalized_alignment ?? null

      // Si save_path fourni : uploader l'audio sur Supabase et retourner url + alignment
      if (save_path) {
        const buffer = Buffer.from(data.audio_base64, 'base64')
        const storagePath = `${save_path}.mp3`
        const { error } = await supabaseAdmin.storage
          .from('audio')
          .upload(storagePath, buffer, { contentType: 'audio/mpeg', upsert: true })
        if (error) throw new Error(`Upload Supabase: ${error.message}`)
        const { data: { publicUrl } } = supabaseAdmin.storage.from('audio').getPublicUrl(storagePath)
        return NextResponse.json({ url: publicUrl, alignment })
      }

      return NextResponse.json({ audio_base64: data.audio_base64, alignment })
    }

    // ── Mode normal : stream audio ────────────────────────────────────────
    const audioStream = await elevenlabs.textToSpeech.convert(voice_id, {
      text,
      modelId,
      outputFormat: 'mp3_44100_128',
      voiceSettings,
    }) as any

    const chunks: Buffer[] = []
    for await (const chunk of audioStream) {
      chunks.push(Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)

    if (save_path) {
      const storagePath = `${save_path}.mp3`
      const { error } = await supabaseAdmin.storage
        .from('audio')
        .upload(storagePath, buffer, { contentType: 'audio/mpeg', upsert: true })
      if (error) throw new Error(`Upload Supabase: ${error.message}`)
      const { data: { publicUrl } } = supabaseAdmin.storage.from('audio').getPublicUrl(storagePath)
      return NextResponse.json({ url: publicUrl })
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (err: any) {
    console.error('[TTS route] error:', err)
    return NextResponse.json({ error: err?.message ?? String(err) ?? 'Erreur TTS' }, { status: 500 })
  }
}
