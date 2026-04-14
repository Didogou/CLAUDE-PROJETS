import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 60

// POST (FormData) { file: File, path: string }
// Upload un fichier audio dans Supabase Storage (bucket "audio")
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const path = formData.get('path') as string | null

    if (!file || !path) {
      return NextResponse.json({ error: 'file et path requis' }, { status: 400 })
    }

    const contentType = file.type || 'audio/mpeg'
    const extMap: Record<string, string> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/flac': 'flac',
      'audio/aac': 'aac',
      'audio/webm': 'webm',
    }
    const ext = extMap[contentType] ?? 'mp3'
    const storagePath = `${path}.${ext}`

    const buffer = await file.arrayBuffer()

    // Crée le bucket audio s'il n'existe pas encore
    await supabaseAdmin.storage.createBucket('audio', { public: true }).catch(() => {})

    const { error } = await supabaseAdmin.storage
      .from('audio')
      .upload(storagePath, buffer, { contentType, upsert: true })

    if (error) throw new Error(`Erreur upload : ${error.message}`)

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('audio')
      .getPublicUrl(storagePath)

    return NextResponse.json({ url: publicUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
