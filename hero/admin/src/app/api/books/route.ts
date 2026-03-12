import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  // Récupérer les livres avec le nombre de sections
  const { data: books, error } = await supabaseAdmin
    .from('books')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!books?.length) return NextResponse.json([])

  // Compter les sections par livre en une seule requête
  const { data: counts } = await supabaseAdmin
    .from('sections')
    .select('book_id')
    .in('book_id', books.map(b => b.id))

  const countMap: Record<string, number> = {}
  for (const row of counts ?? []) {
    countMap[row.book_id] = (countMap[row.book_id] ?? 0) + 1
  }

  const result = books.map(b => ({ ...b, num_sections: countMap[b.id] ?? 0 }))
  return NextResponse.json(result)
}
