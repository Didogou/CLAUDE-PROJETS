import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateText, extractJson } from '@/lib/ai-utils'
import type { IntroFrame } from '@/types'

export const maxDuration = 120

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // Load book + section 1
    const { data: book } = await supabaseAdmin
      .from('books')
      .select('title, theme, illustration_style, protagonist_description, illustration_bible, synopsis')
      .eq('id', id)
      .single()
    if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

    const { data: section1 } = await supabaseAdmin
      .from('sections')
      .select('content, summary')
      .eq('book_id', id)
      .eq('number', 1)
      .single()

    const sceneSource = section1?.content?.trim()
      ? section1.content.slice(0, 1200)
      : section1?.summary?.trim()
        ? section1.summary
        : book.synopsis?.slice(0, 600) ?? 'Scène d\'ouverture du livre.'

    const protagonistLine = book.protagonist_description?.trim()
      ? `Description du protagoniste : ${book.protagonist_description.trim()}`
      : ''

    const bibleLine = book.illustration_bible?.trim()
      ? `Bible visuelle : ${book.illustration_bible.trim().slice(0, 400)}`
      : `Style visuel : ${book.illustration_style ?? 'realistic'}`

    const prompt = `Tu génères un storyboard d'intro cinématique pour un livre "Dont Vous Êtes le Héros".

Livre : "${book.title}" — ${book.theme}
${bibleLine}
${protagonistLine}

Scène source (section 1) :
${sceneSource}

Génère 6 à 8 frames de storyboard. Chaque frame est une variation de la MÊME scène de base, avec UNE SEULE différence par rapport à la frame précédente : cadrage, éclairage, émotion, ou détail.

Principe de progression :
- Frame 1 : plan large — la scène complète, ambiance, décor, personnages
- Frame 2 : même scène + variation d'éclairage ou d'action (ex: éclair, coup de feu, flash)
- Frame 3 : changement de cadrage sur la même scène (plan moyen ou gros plan)
- Frame 4-5 : détails dramatiques (visage, main, objet, regard)
- Dernière frame : fondu noir ou plan final

Règles :
- prompt_fr : description précise, auto-suffisante pour générer l'image (50-80 mots). Reprendre la description de base de la frame 1 et n'ajouter/modifier qu'un élément.
- prompt_en : traduction anglaise fidèle du prompt_fr
- duration : "flash"=0.5s | "court"=1s | "normal"=2.5s | "long"=4s | "pause"=6s
- narrative_text : texte court à afficher sur l'image (max 12 mots, optionnel, null si non pertinent)
- transition : "cut" | "fondu" | "fondu_noir"
- framing : "plan_large" | "plan_moyen" | "gros_plan" | "detail"

Réponds UNIQUEMENT avec du JSON brut valide :
[{ "framing": "plan_large", "prompt_fr": "...", "prompt_en": "...", "duration": "normal", "narrative_text": "Ce soir-là, tous les gangs étaient réunis.", "transition": "cut" }]`

    const raw = await generateText('claude', '', prompt, 4096)
    const parsed: any[] = JSON.parse(extractJson(raw))

    const frames: IntroFrame[] = parsed.map((f, i) => ({
      id: crypto.randomUUID(),
      order: i + 1,
      framing: (['plan_large','plan_moyen','gros_plan','detail'].includes(f.framing) ? f.framing : 'plan_large') as any,
      prompt_fr: f.prompt_fr ?? '',
      prompt_en: f.prompt_en ?? '',
      duration: (['flash','court','normal','long','pause'].includes(f.duration) ? f.duration : 'normal') as any,
      narrative_text: f.narrative_text ?? undefined,
      transition: (['cut','fondu','fondu_noir'].includes(f.transition) ? f.transition : 'cut') as any,
      image_url: undefined,
    }))

    await supabaseAdmin.from('books').update({ intro_sequence: frames }).eq('id', id)

    return NextResponse.json({ frames })
  } catch (err: any) {
    console.error('[generate-intro-sequence]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
