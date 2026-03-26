import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('items')
    .select('*')
    .eq('book_id', id)
    .order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { data, error } = await supabaseAdmin
    .from('items')
    .insert({
      book_id: id,
      name: body.name,
      item_type: body.item_type ?? 'outil',
      category: body.category ?? 'consommable',
      description: body.description ?? null,
      illustration_url: body.illustration_url ?? null,
      cinematique_url: body.cinematique_url ?? null,
      section_found_id: body.section_found_id ?? null,
      sections_used: body.sections_used ?? [],
      use_section_ids: body.use_section_ids ?? [],
      radio_broadcasts: body.radio_broadcasts ?? [],
      effect: body.effect ?? {},
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: bookId } = await params
  const body = await req.json()
  const { item_id, ...fields } = body
  if (!item_id) return NextResponse.json({ error: 'item_id requis' }, { status: 400 })

  const allowed = ['name', 'item_type', 'category', 'description', 'illustration_url', 'cinematique_url',
    'section_found_id', 'sections_used', 'use_section_ids', 'radio_broadcasts', 'effect']
  const update: Record<string, any> = {}
  for (const key of allowed) { if (key in fields) update[key] = fields[key] }

  const { data, error } = await supabaseAdmin
    .from('items').update(update).eq('id', item_id).eq('book_id', bookId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: bookId } = await params
  const { searchParams } = new URL(req.url)
  const item_id = searchParams.get('item_id')
  if (!item_id) return NextResponse.json({ error: 'item_id requis' }, { status: 400 })
  const { error } = await supabaseAdmin.from('items').delete().eq('id', item_id).eq('book_id', bookId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
