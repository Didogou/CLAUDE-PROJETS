import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateText } from '@/lib/ai-utils'

export const maxDuration = 120

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: book, error } = await supabaseAdmin
    .from('books')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })
  if (!book.book_summary?.trim()) return NextResponse.json({ error: 'Aucun résumé à développer' }, { status: 400 })

  // Récupérer la bible de série et les autres tomes si le livre fait partie d'un projet
  let seriesBible: string | null = null
  let siblingBooks: { order_in_series: number; title: string; book_summary: string }[] = []

  if (book.project_id) {
    const [{ data: project }, { data: siblings }] = await Promise.all([
      supabaseAdmin.from('projects').select('title, theme, series_bible').eq('id', book.project_id).single(),
      supabaseAdmin
        .from('books')
        .select('order_in_series, title, book_summary')
        .eq('project_id', book.project_id)
        .neq('id', id)
        .order('order_in_series'),
    ])
    seriesBible = project?.series_bible ?? null
    siblingBooks = (siblings ?? []).filter((b: any) => b.book_summary) as any
  }

  const lang = book.language === 'fr' ? 'français' : 'anglais'
  const addressNote = book.address_form === 'tu'
    ? 'Le héros est interpellé en tutoiement ("Tu avances...", "Tu choisis...")'
    : 'Le héros est interpellé en vouvoiement ("Vous avancez...", "Vous choisissez...")'

  const siblingSection = siblingBooks.length > 0
    ? `\n\n--- AUTRES TOMES DE LA SÉRIE ---\n${siblingBooks.map((b: any) => `Tome ${b.order_in_series} — "${b.title}"\n${b.book_summary}`).join('\n\n')}\n---`
    : ''

  const seriesSection = seriesBible
    ? `\n\n--- BIBLE DE SÉRIE (contexte global) ---\n${seriesBible.slice(0, 3000)}\n---`
    : ''

  const systemPrompt = `Tu es un auteur expert en livres "Dont Vous Êtes le Héros" (DYEH) et en écriture de synopsis narratifs.`

  const userPrompt = `Voici le résumé court d'un tome DYEH. Développe-le en **synopsis détaillé** destiné à guider la rédaction des sections du livre.

**Informations sur le livre :**
- Titre : "${book.title}"
- Thème : ${book.theme}
- Ambiance : ${book.context_type}
- Public : ${book.age_range} ans
- Langue : ${lang}
- Difficulté : ${book.difficulty}
- Tome : ${book.order_in_series ?? 'indépendant'}
- ${addressNote}
${book.description ? `- Description auteur : ${book.description}` : ''}
${seriesSection}${siblingSection}

**Résumé à développer :**
${book.book_summary}

---

**Consignes :**
Produis un synopsis de 500 à 900 mots organisé ainsi :

## Contexte et point de départ
(Situation initiale, monde, où se trouve le héros, quel événement le met en mouvement)

## Enjeux et objectif principal
(Ce que le héros doit accomplir, les dangers, les motivations profondes)

## Acte 1 — Mise en route
(Les premières épreuves, rencontres clés, découvertes, décisions initiales)

## Acte 2 — Développement et complications
(Les obstacles majeurs, retournements, personnages importants, lieux traversés, montée de la tension)

## Acte 3 — Climax et dénouements possibles
(L'affrontement final ou l'épreuve décisive, les différentes fins possibles : victoire(s) et mort(s))

## Atmosphère et style attendus
(Ton, rythme, registre émotionnel, images fortes à conserver)
${siblingBooks.length > 0 ? '\n## Liens avec la série\n(Comment ce tome s\'articule avec les autres — fils narratifs communs, ce qui vient avant et après)' : ''}

Écris en ${lang}. Sois concret. Ce synopsis sert de feuille de route pour écrire les sections.`

  try {
    const synopsis = await generateText('claude', systemPrompt, userPrompt, 4000)
    await supabaseAdmin.from('books').update({ synopsis }).eq('id', id)
    return NextResponse.json({ synopsis })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
