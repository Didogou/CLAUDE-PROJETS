import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: book } = await supabaseAdmin.from('books').select('*').eq('id', id).single()
  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const { data: sections } = await supabaseAdmin
    .from('sections').select('number, content, summary').eq('book_id', id).order('number').limit(3)

  const firstSections = (sections ?? [])
    .map(s => `§${s.number} — ${s.summary ?? s.content?.slice(0, 120) ?? ''}`)
    .join('\n')

  const prompt = `Tu es un auteur de livres "Dont Vous Êtes le Héros" dans le style de Pierre Bordage.

Écris le PROLOGUE d'introduction de ce livre. Ce texte apparaît AVANT la section 1.

Livre : "${book.title}"
Thème : ${book.theme} — ${book.context_type}
Public : ${book.age_range} ans
Contexte de l'auteur :
${book.description ?? '(non précisé)'}

Début de l'aventure (premières sections) :
${firstSections || '(non disponible)'}

OBJECTIF DU PROLOGUE :
- Planter le décor : monde, époque, ambiance sensorielle (sons, odeurs, lumières)
- Présenter qui est le lecteur (son identité, son passé proche, sa situation)
- Créer une tension narrative progressive, sans action immédiate
- Laisser le temps de l'immersion — pas de combat, pas de choix, pas de péril immédiat
- Se terminer sur le moment précis où l'aventure commence (transition vers §1)

STYLE :
- 2ème personne du singulier ("Vous vous réveillez...", "Le vent fouette votre visage...")
- Phrases rythmées, atmosphère dense et sensorielle
- Entre 250 et 400 mots
- Aucune mention de numéro de section
- Pas de titre, pas de chapeau — commence directement par le texte narratif`

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })
    const message = await stream.finalMessage()
    const intro_text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

    const { error } = await supabaseAdmin.from('books').update({ intro_text }).eq('id', id)
    if (error) throw error

    return NextResponse.json({ intro_text })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
