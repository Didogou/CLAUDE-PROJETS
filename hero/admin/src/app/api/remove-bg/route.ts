import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const REMBG_URL = process.env.REMBG_URL ?? 'http://127.0.0.1:8189'

// POST { image_url } — removes background locally via rembg server
// Returns the processed image (composited on gray #808080, 1024x1024)
// Then uploads to Supabase and returns { image_url }

export async function POST(req: NextRequest) {
  try {
    const { image_url } = await req.json() as { image_url: string }
    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })

    // Call local rembg server
    const res = await fetch(`${REMBG_URL}/remove-bg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`rembg server error (${res.status}): ${errText}`)
    }

    // Get the processed PNG image
    const imageBuffer = Buffer.from(await res.arrayBuffer())

    // Upload to Supabase Storage
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Use a temp path, the caller will save to the right location
    const tempPath = `temp/rembg_${Date.now()}.png`
    const { error: uploadError } = await supabase.storage
      .from('images')
      .upload(tempPath, imageBuffer, { contentType: 'image/png', upsert: true })

    if (uploadError) throw new Error(`Upload Supabase: ${uploadError.message}`)

    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(tempPath)

    return NextResponse.json({ image_url: publicUrl })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[remove-bg] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
