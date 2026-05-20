import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { error } = await supabaseAdmin.from('books').update(body).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('books').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Parallèle : book + sections + npcs + items (pour le Designer qui charge
  // les persos/objets du livre dans son catalogue).
  const [{ data: book }, { data: sections }, { data: npcs }, { data: items }] = await Promise.all([
    supabaseAdmin.from('books').select('*').eq('id', id).single(),
    supabaseAdmin.from('sections').select('*').eq('book_id', id).order('number'),
    supabaseAdmin.from('npcs').select('*').eq('book_id', id),
    supabaseAdmin.from('items').select('*').eq('book_id', id),
  ])

  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sectionIds = (sections ?? []).map((s: any) => s.id)
  const { data: choices } = sectionIds.length > 0
    ? await supabaseAdmin.from('choices').select('*').in('section_id', sectionIds)
    : { data: [] }

  return NextResponse.json({
    book,
    sections: sections ?? [],
    choices: choices ?? [],
    npcs: npcs ?? [],
    items: items ?? [],
  })
}
