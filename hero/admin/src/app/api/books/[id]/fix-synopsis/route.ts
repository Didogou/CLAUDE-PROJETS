import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateText, extractJson } from '@/lib/ai-utils'

export const maxDuration = 120

export interface SynopsisCorrection {
  book_id: string
  tome: number
  title: string
  corrected_synopsis: string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { issue_type, problem } = await req.json()

  const { data: book, error } = await supabaseAdmin
    .from('books')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })
  if (!book.synopsis?.trim()) return NextResponse.json({ error: 'Aucun synopsis à corriger' }, { status: 400 })

  // Charger tous les tomes du projet
  let allBooks: any[] = []
  let seriesBible = ''

  if (book.project_id) {
    const [{ data: project }, { data: siblings }] = await Promise.all([
      supabaseAdmin.from('projects').select('title, theme, series_bible').eq('id', book.project_id).single(),
      supabaseAdmin
        .from('books')
        .select('id, order_in_series, title, synopsis')
        .eq('project_id', book.project_id)
        .order('order_in_series'),
    ])
    if (project?.series_bible) seriesBible = project.series_bible.slice(0, 1500)
    allBooks = (siblings ?? []).filter((b: any) => b.synopsis?.trim())
  }

  // Si le livre n'est pas dans le projet ou n'a pas de frères, on l'ajoute seul
  if (!allBooks.find((b: any) => b.id === id)) {
    allBooks = [{ id: book.id, order_in_series: book.order_in_series, title: book.title, synopsis: book.synopsis }]
  }

  const issueLabel: Record<string, string> = {
    personnage:  'incohérence de personnage',
    chronologie: 'incohérence chronologique',
    univers:     'incohérence d\'univers',
    intrigue:    'rupture d\'intrigue',
    ton:         'rupture de ton',
    fin_serie:   'fin canonique de série à aligner',
  }

  // Construire la liste des synopsis disponibles
  const synopsisList = allBooks
    .map((b: any) => `=== TOME ${b.order_in_series} — "${b.title}" (book_id: ${b.id}) ===\n${b.synopsis}`)
    .join('\n\n')

  const seriesSection = seriesBible ? `\n--- BIBLE DE SÉRIE ---\n${seriesBible}\n---\n` : ''

  const systemPrompt = `Tu es un auteur expert en livres "Dont Vous Êtes le Héros" (DYEH). Tu corriges des synopsis pour résoudre un problème de cohérence narrative entre les tomes d'une série.`

  const userPrompt = `Résous le problème de cohérence détecté dans cette série DYEH.

**Problème (${issueLabel[issue_type] ?? issue_type}) — détecté sur le Tome ${book.order_in_series} "${book.title}" :**
${problem}
${seriesSection}
**Synopsis de tous les tomes concernés :**
${synopsisList}

---

**Instructions :**
- Corrige UNIQUEMENT les synopsis qui doivent être modifiés pour résoudre ce problème
- Un problème peut nécessiter de modifier 1 ou plusieurs tomes (ex: fin d'un tome + début du suivant)
- Conserve la structure (## sections) et le niveau de détail de chaque synopsis
- Modifie le moins possible — seulement ce qui est strictement nécessaire

Retourne UNIQUEMENT un tableau JSON valide (sans markdown) :
[
  {
    "book_id": "uuid exact du livre modifié",
    "tome": numéro,
    "title": "titre du tome",
    "corrected_synopsis": "synopsis complet corrigé"
  }
]

Si un seul tome est concerné, retourne un tableau avec un seul élément.`

  try {
    const raw = await generateText('claude', systemPrompt, userPrompt, 8000)
    const corrections: SynopsisCorrection[] = JSON.parse(extractJson(raw))
    return NextResponse.json({ corrections })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
