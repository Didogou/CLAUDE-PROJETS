import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('locations')
    .select('*')
    .eq('book_id', id)
    .order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Met à jour x,y d'un lieu (repositionnement admin)
  const { id } = await params
  const { location_id, x, y } = await req.json()
  const { error } = await supabaseAdmin
    .from('locations')
    .update({ x, y })
    .eq('id', location_id)
    .eq('book_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
