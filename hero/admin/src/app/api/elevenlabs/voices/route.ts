import { NextResponse } from 'next/server'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'

const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY })

export async function GET() {
  try {
    const res = await elevenlabs.voices.getAll()
    const voices = (res.voices ?? [])
      .map((v: any) => ({
        voice_id: v.voiceId ?? v.voice_id,
        name: v.name,
        category: v.category,
        labels: v.labels ?? {},
        preview_url: v.previewUrl ?? v.preview_url ?? null,
      }))
    return NextResponse.json({ voices })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Erreur ElevenLabs' }, { status: 500 })
  }
}
