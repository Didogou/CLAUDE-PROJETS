import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 120

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

// POST { prompt, duration, path }
// path ex: "books/123/npcs/456/create_music" ou "books/123/sections/789/music"
export async function POST(req: NextRequest) {
  try {
    const { prompt, duration = 15, path } = await req.json() as {
      prompt: string
      duration?: number
      path: string
    }
    if (!prompt || !path) return NextResponse.json({ error: 'prompt et path requis' }, { status: 400 })

    // Génération via MusicGen (meta/musicgen)
    const output = await replicate.run(
      'meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb',
      {
        input: {
          prompt,
          duration: Math.min(Math.max(duration, 5), 30),
          model_version: 'stereo-large',
          output_format: 'mp3',
          normalization_strategy: 'peak',
        },
      }
    ) as any

    // Récupérer l'URL ou le blob selon le type retourné
    let audioBuffer: ArrayBuffer
    if (typeof output?.url === 'function') {
      const res = await fetch(output.url().toString())
      audioBuffer = await res.arrayBuffer()
    } else if (typeof output === 'string') {
      const res = await fetch(output)
      audioBuffer = await res.arrayBuffer()
    } else {
      throw new Error('Format de sortie Replicate inattendu')
    }

    // Upload dans Supabase Storage (bucket "audio")
    const storagePath = `${path}.mp3`
    const { error } = await supabaseAdmin.storage
      .from('audio')
      .upload(storagePath, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      })
    if (error) throw new Error(`Erreur upload Supabase : ${error.message}`)

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('audio')
      .getPublicUrl(storagePath)

    return NextResponse.json({ url: publicUrl })
  } catch (err: any) {
    console.error('[generate-music]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
