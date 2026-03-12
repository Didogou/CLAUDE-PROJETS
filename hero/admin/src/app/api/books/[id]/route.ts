import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('books').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [{ data: book }, { data: sections }] = await Promise.all([
    supabaseAdmin.from('books').select('*').eq('id', id).single(),
    supabaseAdmin.from('sections').select('*').eq('book_id', id).order('number'),
  ])

  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sectionIds = (sections ?? []).map((s: any) => s.id)
  const { data: choices } = sectionIds.length > 0
    ? await supabaseAdmin.from('choices').select('*').in('section_id', sectionIds)
    : { data: [] }

  return NextResponse.json({ book, sections: sections ?? [], choices: choices ?? [] })
}
