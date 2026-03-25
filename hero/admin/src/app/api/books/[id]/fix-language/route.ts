import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 30

// Applique les corrections orthographiques/grammaticales directement par remplacement de chaînes
// (pas besoin de Claude — on a déjà original → correction)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { errors } = await req.json() as {
      errors: { number: number; errors: { original: string; correction: string }[] }[]
    }

    const { data: sections } = await supabaseAdmin
      .from('sections').select('id, number, content').eq('book_id', id)

    if (!sections?.length) return NextResponse.json({ error: 'Sections introuvables' }, { status: 404 })

    const sectionByNumber = new Map(sections.map(s => [s.number, s]))
    const applied: number[] = []

    for (const secErrors of errors) {
      const sec = sectionByNumber.get(secErrors.number)
      if (!sec || !sec.content) continue

      let content = sec.content
      for (const err of secErrors.errors) {
        if (!err.original || !err.correction) continue
        // Remplacement exact d'abord
        if (content.includes(err.original)) {
          content = content.split(err.original).join(err.correction)
        } else {
          // Fallback : normaliser les espaces insécables et guillemets typographiques
          const normalize = (s: string) => s.replace(/\u00a0/g, ' ').replace(/\u2019/g, "'").replace(/\u2018/g, "'")
          const normalizedContent = normalize(content)
          const normalizedOriginal = normalize(err.original)
          if (normalizedContent.includes(normalizedOriginal)) {
            content = normalizedContent.split(normalizedOriginal).join(err.correction)
          }
        }
      }

      if (content !== sec.content) {
        await supabaseAdmin.from('sections').update({ content }).eq('id', sec.id)
        applied.push(secErrors.number)
      }
    }

    return NextResponse.json({ applied })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Erreur inconnue' }, { status: 500 })
  }
}
