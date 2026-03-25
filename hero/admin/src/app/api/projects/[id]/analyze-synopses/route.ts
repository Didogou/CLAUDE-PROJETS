import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateText, extractJson } from '@/lib/ai-utils'

export const maxDuration = 120

export interface SynopsisProposal {
  id: string
  book_id: string
  tome: number
  title: string
  issue_type: 'personnage' | 'chronologie' | 'univers' | 'intrigue' | 'ton' | 'fin_serie'
  problem: string
  // corrected_synopsis est généré à la demande via /api/books/[id]/fix-synopsis
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('title, theme, series_bible')
    .eq('id', id)
    .single()

  if (!project) return NextResponse.json({ error: 'Projet introuvable' }, { status: 404 })

  const { data: books } = await supabaseAdmin
    .from('books')
    .select('id, title, order_in_series, synopsis')
    .eq('project_id', id)
    .order('order_in_series')

  const booksWithSynopsis = (books ?? []).filter((b: any) => b.synopsis?.trim())

  if (booksWithSynopsis.length < 2) {
    return NextResponse.json({ error: 'Il faut au moins 2 synopsis pour analyser la cohérence.' }, { status: 400 })
  }

  const booksList = booksWithSynopsis
    .map((b: any) => `=== TOME ${b.order_in_series} — "${b.title}" (book_id: ${b.id}) ===\n${b.synopsis}`)
    .join('\n\n')

  const seriesContext = project.series_bible
    ? `\n\n--- BIBLE DE SÉRIE ---\n${project.series_bible.slice(0, 2000)}\n---`
    : ''

  const lastTome = booksWithSynopsis[booksWithSynopsis.length - 1]

  const systemPrompt = `Tu es un éditeur littéraire expert en séries de livres "Dont Vous Êtes le Héros".`

  const userPrompt = `Analyse la cohérence entre les synopsis des tomes de cette série DYEH.

Série : "${project.title}" — ${project.theme}${seriesContext}

--- SYNOPSIS ---
${booksList}
---

## MISSION 1 — Incohérences générales
Types : personnage, chronologie, univers, intrigue, ton

## MISSION 2 — Fin canonique
Vérifie que la victoire de chaque tome enchaîne logiquement avec le suivant. Le dernier tome (Tome ${lastTome.order_in_series} — "${lastTome.title}") doit conclure toute la série.

Retourne UNIQUEMENT un tableau JSON compact (sans synopses, juste les diagnostics) :
[
  {
    "book_id": "uuid exact",
    "tome": numéro,
    "title": "titre",
    "issue_type": "personnage|chronologie|univers|intrigue|ton|fin_serie",
    "problem": "Description précise du problème en 2-3 phrases max"
  }
]

Règles :
- Seulement les problèmes réels, pas de style
- Maximum 10 entrées
- Si aucun problème : tableau vide []`

  try {
    const raw = await generateText('claude', systemPrompt, userPrompt, 2000)
    const proposals: Omit<SynopsisProposal, 'id'>[] = JSON.parse(extractJson(raw))

    const withIds: SynopsisProposal[] = proposals.map((p, i) => ({
      ...p,
      id: `${p.book_id}-${i}-${Date.now()}`,
    }))

    return NextResponse.json({ proposals: withIds })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
