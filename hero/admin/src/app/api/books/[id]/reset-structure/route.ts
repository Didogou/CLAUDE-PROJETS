import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: book } = await supabaseAdmin.from('books').select('phase').eq('id', id).single()
  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  // Toutes les phases sauf 'draft' (déjà vide) peuvent être réinitialisées
  if (book.phase === 'draft') {
    return NextResponse.json({ error: 'La structure est déjà vide' }, { status: 409 })
  }

  // Récupérer les IDs des sections pour supprimer les choix
  const { data: sections } = await supabaseAdmin.from('sections').select('id').eq('book_id', id)
  const sectionIds = (sections ?? []).map(s => s.id)

  // Supprimer dans l'ordre (contraintes FK)
  if (sectionIds.length > 0) {
    await supabaseAdmin.from('choices').delete().in('section_id', sectionIds)
  }
  await supabaseAdmin.from('sections').delete().eq('book_id', id)
  await supabaseAdmin.from('npcs').delete().eq('book_id', id)
  await supabaseAdmin.from('locations').delete().eq('book_id', id)

  // Remettre en brouillon
  await supabaseAdmin.from('books').update({ phase: 'draft', map_svg: null }).eq('id', id)

  return NextResponse.json({ success: true })
}
