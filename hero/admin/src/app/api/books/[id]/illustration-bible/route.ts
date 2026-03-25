import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { translateToEnglish } from '@/lib/ai-utils'

// POST { text_fr } — sauvegarde le texte FR + retourne la traduction EN pour prévisualisation
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { text_fr } = await req.json() as { text_fr: string }

  if (!text_fr?.trim()) {
    await supabaseAdmin.from('books').update({ illustration_bible: null }).eq('id', id)
    return NextResponse.json({ illustration_bible: null, illustration_bible_en: null })
  }

  // Sauvegarde du texte français
  await supabaseAdmin.from('books').update({ illustration_bible: text_fr.trim() }).eq('id', id)

  // Traduction EN pour prévisualisation
  const illustration_bible_en = await translateToEnglish(text_fr.trim())

  return NextResponse.json({ illustration_bible: text_fr.trim(), illustration_bible_en })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await supabaseAdmin.from('books').update({ illustration_bible: null }).eq('id', id)
  return NextResponse.json({ success: true })
}
