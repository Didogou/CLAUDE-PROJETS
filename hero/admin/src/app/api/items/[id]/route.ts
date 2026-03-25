import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const allowed: Record<string, any> = {}
  if ('name' in body) allowed.name = body.name
  if ('item_type' in body) allowed.item_type = body.item_type
  if ('description' in body) allowed.description = body.description ?? null
  if ('illustration_url' in body) allowed.illustration_url = body.illustration_url ?? null
  if ('section_found_id' in body) allowed.section_found_id = body.section_found_id ?? null
  if ('sections_used' in body) allowed.sections_used = body.sections_used ?? []
  if ('effect' in body) allowed.effect = body.effect ?? {}
  const { error } = await supabaseAdmin.from('items').update(allowed).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('items').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
