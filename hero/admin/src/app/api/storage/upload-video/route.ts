import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60
// Bodies vidéo peuvent atteindre ~50-100 MB en base64 (file ~37-75 MB).
// Next.js App Router accepte jusqu'à `bodySizeLimit` MB (défaut très bas).
// On override via `runtime: 'nodejs'` + relâche la limite via la conf de route.
export const runtime = 'nodejs'

/**
 * POST /api/storage/upload-video
 *
 * Upload une vidéo (data URL base64) dans le bucket Supabase `images` et
 * retourne son URL publique. Strictement parallèle à `upload-image`, mais
 * accepte les MIME `video/mp4`, `video/webm`, `video/quicktime` (.mov).
 *
 * Body : { data_url, path? }
 *   - `data_url` (req) : "data:video/mp4;base64,..." (ou webm / quicktime)
 *   - `path` (opt)     : chemin relatif dans le bucket. Défaut : "temp/video_{ts}.{ext}"
 *
 * Retour : { url } (URL publique Supabase)
 *
 * Usage typique : import manuel d'une vidéo existante dans le panneau
 * Animation du Studio Designer (= se comporte comme une gen LTX réussie).
 */
export async function POST(req: NextRequest) {
  try {
    const { data_url, path } = await req.json() as { data_url: string; path?: string }

    if (!data_url || !data_url.startsWith('data:video/')) {
      return NextResponse.json(
        { error: 'data_url manquant ou format invalide (attendu: data:video/...;base64,...)' },
        { status: 400 },
      )
    }

    // Parse data URL: data:video/mp4;base64,AAAA...
    const match = data_url.match(/^data:video\/([\w-]+);base64,(.+)$/)
    if (!match) {
      return NextResponse.json({ error: 'data_url vidéo malformé' }, { status: 400 })
    }
    const subtype = match[1].toLowerCase()  // mp4, webm, quicktime, x-matroska...
    const base64Data = match[2]
    const buffer = Buffer.from(base64Data, 'base64')

    // Mapping subtype → extension fichier
    const extMap: Record<string, string> = {
      mp4: 'mp4',
      webm: 'webm',
      quicktime: 'mov',
      'x-matroska': 'mkv',
      ogg: 'ogv',
    }
    const ext = extMap[subtype] ?? subtype
    const contentType = `video/${subtype}`
    const finalPath = path ?? `temp/video_${Date.now()}.${ext}`

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Bucket dédié `videos` (séparé d'`images`). Permet de configurer des
    // policies RLS / quotas / MIME restrictions distincts. Le bucket doit
    // exister côté Supabase avec MIME `video/*` autorisés.
    const { error: uploadError } = await supabase.storage
      .from('videos')
      .upload(finalPath, buffer, { contentType, upsert: true })

    if (uploadError) {
      throw new Error(`Supabase upload: ${uploadError.message}`)
    }

    const { data: { publicUrl } } = supabase.storage.from('videos').getPublicUrl(finalPath)

    return NextResponse.json({ url: publicUrl })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[storage/upload-video]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
