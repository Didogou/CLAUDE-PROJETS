import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateText } from '@/lib/ai-utils'
import { buildSeriesAnalysisPrompt } from '@/lib/prompts'

export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const { data: project } = await supabaseAdmin.from('projects').select('*').eq('id', id).single()
    if (!project) return NextResponse.json({ error: 'Projet introuvable' }, { status: 404 })

    const { data: books } = await supabaseAdmin
      .from('books').select('order_in_series, title, book_summary')
      .eq('project_id', id).order('order_in_series')

    const analysis = await generateText(
      'claude',
      'Tu es un éditeur littéraire expert. Réponds uniquement avec le rapport demandé en markdown.',
      buildSeriesAnalysisPrompt(project, books ?? []),
      3000
    )

    await supabaseAdmin.from('projects').update({ series_analysis: analysis }).eq('id', id)
    return NextResponse.json({ analysis })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
