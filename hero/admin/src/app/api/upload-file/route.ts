import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 60

// POST (FormData) { file: File, path: string }
// Upload un fichier local dans Supabase Storage (bucket "images")
// path ex: "books/123/npcs/456/background", "books/123/npcs/456/portrait"
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const path = formData.get('path') as string | null

    if (!file || !path) {
      return NextResponse.json({ error: 'file et path requis' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const contentType = file.type || 'image/jpeg'
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const storagePath = `${path}.${ext}`

    const { error } = await supabaseAdmin.storage
      .from('images')
      .upload(storagePath, buffer, { contentType, upsert: true })

    if (error) throw new Error(`Erreur upload : ${error.message}`)

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('images')
      .getPublicUrl(storagePath)

    return NextResponse.json({ url: publicUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
