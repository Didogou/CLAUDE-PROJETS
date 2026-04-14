import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 60

// POST { url, path } — télécharge une image externe et l'upload dans Supabase Storage
// path ex: "books/123/cover", "books/123/sections/456", "books/123/npcs/789"
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''

    // ── Mode FormData (upload fichier local) ──────────────────────────────
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      const path = formData.get('path') as string | null
      if (!file || !path) return NextResponse.json({ error: 'file et path requis' }, { status: 400 })

      const fileType = file.type || 'image/png'
      const extMap: Record<string, string> = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
        'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
      }
      const ext = extMap[fileType] ?? 'png'
      const storagePath = `${path}.${ext}`
      const buffer = await file.arrayBuffer()

      await supabaseAdmin.storage.createBucket('images', { public: true }).catch(() => {})
      const { error } = await supabaseAdmin.storage
        .from('images').upload(storagePath, buffer, { contentType: fileType, upsert: true })
      if (error) throw new Error(error.message)

      const { data: { publicUrl } } = supabaseAdmin.storage.from('images').getPublicUrl(storagePath)
      return NextResponse.json({ url: publicUrl })
    }

    // ── Mode JSON (téléchargement URL externe) ────────────────────────────
    const { url, path: jsonPath } = await req.json() as { url: string; path: string }
    if (!url || !jsonPath) return NextResponse.json({ error: 'url et path requis' }, { status: 400 })

    // Télécharger l'image depuis l'URL externe
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Erreur téléchargement image : ${response.status}`)

    const buffer = await response.arrayBuffer()
    const mime = response.headers.get('content-type') ?? 'image/webp'
    const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : 'webp'
    const storagePath = `${jsonPath}.${ext}`

    // Upload dans Supabase Storage (bucket "images")
    const { error } = await supabaseAdmin.storage
      .from('images')
      .upload(storagePath, buffer, {
        contentType: mime,
        upsert: true,
      })

    if (error) throw new Error(`Erreur upload Supabase : ${error.message}`)

    // URL publique
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('images')
      .getPublicUrl(storagePath as string)

    return NextResponse.json({ url: publicUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
