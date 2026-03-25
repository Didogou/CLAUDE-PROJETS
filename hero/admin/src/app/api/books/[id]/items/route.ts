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
      description: body.description ?? null,
      illustration_url: body.illustration_url ?? null,
      section_found_id: body.section_found_id ?? null,
      sections_used: body.sections_used ?? [],
      effect: body.effect ?? {},
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}
