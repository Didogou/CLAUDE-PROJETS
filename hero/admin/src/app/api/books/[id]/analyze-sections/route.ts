import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateText } from '@/lib/ai-utils'
import { buildSectionAnalysisPrompt } from '@/lib/prompts'

export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const { data: book } = await supabaseAdmin.from('books').select('*').eq('id', id).single()
    if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })
    if (book.phase !== 'structure_generated' && book.phase !== 'structure_validated') {
      return NextResponse.json({ error: 'La structure doit être générée avant l\'analyse' }, { status: 409 })
    }

    const { data: sections } = await supabaseAdmin
      .from('sections')
      .select('id, number, summary, narrative_arc, is_ending, ending_type')
      .eq('book_id', id)
      .order('number')

    const { data: choices } = await supabaseAdmin
      .from('choices')
      .select('id, section_id, label, target_section_id')
      .in('section_id', (sections ?? []).map(s => s.id))

    const analysis = await generateText(
      'claude',
      'Tu es un éditeur littéraire expert. Réponds uniquement avec le rapport demandé en markdown.',
      buildSectionAnalysisPrompt(book, sections ?? [], choices ?? []),
      4000
    )

    await supabaseAdmin.from('books').update({ story_analysis: analysis }).eq('id', id)
    return NextResponse.json({ analysis })
  } catch (err: any) {
    console.error('[analyze-sections]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
