import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

/**
 * POST /api/storage/upload-image
 *
 * Upload une image (data URL base64) dans le bucket Supabase `images` et
 * retourne son URL publique.
 *
 * Body : { data_url, path? }
 *   - `data_url` (req) : "data:image/jpeg;base64,..." ou "data:image/png;base64,..."
 *   - `path` (opt)     : chemin relatif dans le bucket. Défaut : "temp/upload_{ts}.{ext}"
 *
 * Retour : { url } (URL publique Supabase)
 *
 * Usage typique : extraction de frames depuis un <video> côté client (canvas
 * toDataURL → fetch ici → URL Supabase persistable). Voir extractFramesFromVideo
 * dans `lib/extract-frames.ts`.
 */
export async function POST(req: NextRequest) {
  try {
    const { data_url, path } = await req.json() as { data_url: string; path?: string }

    if (!data_url || !data_url.startsWith('data:image/')) {
      return NextResponse.json(
        { error: 'data_url manquant ou format invalide (attendu: data:image/...;base64,...)' },
        { status: 400 },
      )
    }

    // Parse data URL: data:image/jpeg;base64,/9j/4AAQ...
    const match = data_url.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!match) {
      return NextResponse.json({ error: 'data_url malformé' }, { status: 400 })
    }
    const ext = match[1].toLowerCase()  // jpeg, png, webp
    const base64Data = match[2]
    const buffer = Buffer.from(base64Data, 'base64')

    const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
    const finalPath = path ?? `temp/upload_${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { error: uploadError } = await supabase.storage
      .from('images')
      .upload(finalPath, buffer, { contentType, upsert: true })

    if (uploadError) {
      throw new Error(`Supabase upload: ${uploadError.message}`)
    }

    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(finalPath)

    return NextResponse.json({ url: publicUrl })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[storage/upload-image]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
