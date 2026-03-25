import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 60

// POST { url, path } — télécharge une image externe et l'upload dans Supabase Storage
// path ex: "books/123/cover", "books/123/sections/456", "books/123/npcs/789"
export async function POST(req: NextRequest) {
  try {
    const { url, path } = await req.json() as { url: string; path: string }
    if (!url || !path) return NextResponse.json({ error: 'url et path requis' }, { status: 400 })

    // Télécharger l'image depuis l'URL externe
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Erreur téléchargement image : ${response.status}`)

    const buffer = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') ?? 'image/webp'
    const ext = contentType.includes('png') ? 'png' : contentType.includes('jpeg') ? 'jpg' : 'webp'
    const storagePath = `${path}.${ext}`

    // Upload dans Supabase Storage (bucket "images")
    const { error } = await supabaseAdmin.storage
      .from('images')
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      })

    if (error) throw new Error(`Erreur upload Supabase : ${error.message}`)

    // URL publique
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('images')
      .getPublicUrl(storagePath)

    return NextResponse.json({ url: publicUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
