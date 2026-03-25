import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('*, books(count)')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const projects = (data ?? []).map((p: any) => ({
    ...p,
    books_count: p.books?.[0]?.count ?? 0,
    books: undefined,
  }))
  return NextResponse.json(projects)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { title, theme, num_books, description } = body
    if (!title || !theme) return NextResponse.json({ error: 'title et theme requis' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({ title, theme, num_books: num_books ?? 1, description: description ?? null })
      .select().single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
