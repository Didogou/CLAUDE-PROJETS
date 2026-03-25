import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateText, extractJson } from '@/lib/ai-utils'
import { buildProjectBooksPrompt } from '@/lib/prompts'

export const maxDuration = 120

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const { data: project, error } = await supabaseAdmin
      .from('projects').select('*').eq('id', id).single()
    if (error || !project) return NextResponse.json({ error: 'Projet introuvable' }, { status: 404 })
    if (project.status !== 'draft') {
      return NextResponse.json({ error: 'La bible a déjà été générée' }, { status: 409 })
    }

    // Appel Claude pour générer N résumés de livres
    const raw = await generateText(
      'claude',
      'Tu es un générateur de JSON. Ta réponse entière doit être du JSON brut valide. Commence par [ et termine par ]. Aucun texte avant ou après.',
      buildProjectBooksPrompt({
        title: project.title,
        theme: project.theme,
        num_books: project.num_books,
        description: project.description,
        age_range: '18+',
        context_type: 'Aventure',
        language: 'fr',
        difficulty: 'normal',
      }),
      8000
    )

    let bibleBooks: any[]
    try {
      bibleBooks = JSON.parse(extractJson(raw))
      if (!Array.isArray(bibleBooks)) throw new Error('Réponse non-tableau')
    } catch {
      throw new Error(`JSON invalide : ${raw.slice(0, 300)}`)
    }

    // Créer les livres vides en DB
    const booksToInsert = bibleBooks.map((b: any) => ({
      project_id:        id,
      title:             b.title ?? `Livre ${b.order_in_series}`,
      book_summary:      b.book_summary ?? '',
      order_in_series:   b.order_in_series ?? 1,
      phase:             'draft',
      status:            'draft',
      // Paramètres hérités du projet (valeurs par défaut, modifiables ensuite)
      theme:             project.theme,
      age_range:         '18+',
      context_type:      'Aventure',
      language:          'fr',
      difficulty:        'normal',
      content_mix:       { combat: 20, chance: 10, enigme: 10, magie: 5 },
      map_visibility:    'full',
    }))

    const { data: insertedBooks, error: booksError } = await supabaseAdmin
      .from('books').insert(booksToInsert).select()
    if (booksError) throw booksError

    // Sauvegarder la bible et mettre à jour le statut
    await supabaseAdmin.from('projects').update({
      series_bible: JSON.stringify(bibleBooks),
      status: 'bible_generated',
    }).eq('id', id)

    return NextResponse.json({ books: insertedBooks })
  } catch (err: any) {
    console.error('[generate-books]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
