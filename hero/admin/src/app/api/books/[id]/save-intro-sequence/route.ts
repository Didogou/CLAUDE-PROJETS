import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { frames, audio_url } = await req.json()
    const update: Record<string, any> = { intro_sequence: frames }
    if (audio_url !== undefined) update.intro_audio_url = audio_url || null
    await supabaseAdmin.from('books').update(update).eq('id', id)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
