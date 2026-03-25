import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [{ data: project, error }, { data: books }] = await Promise.all([
    supabaseAdmin.from('projects').select('*').eq('id', id).single(),
    supabaseAdmin.from('books').select('*').eq('project_id', id).order('order_in_series'),
  ])
  if (error || !project) return NextResponse.json({ error: 'Projet introuvable' }, { status: 404 })
  return NextResponse.json({ project, books: books ?? [] })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const allowed: Record<string, any> = {}
  const fields = ['title', 'theme', 'num_books', 'description', 'series_bible', 'series_analysis', 'status']
  for (const f of fields) if (f in body) allowed[f] = body[f]

  const { data, error } = await supabaseAdmin.from('projects').update(allowed).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('projects').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
