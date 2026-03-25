import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 30

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { choiceId, sourceContent, choiceLabel, targetContent, mode } = await req.json() as {
      choiceId: string
      sourceContent: string
      choiceLabel: string
      targetContent: string
      mode?: 'transition' | 'return'
    }

    if (!choiceId || !sourceContent || !targetContent) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
    }

    const isReturn = mode === 'return'

    const { data: book } = await supabaseAdmin
      .from('books').select('title, theme, language, age_range').eq('id', id).single()

    if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

    const langLabel = book.language === 'en' ? 'anglaise' : 'française'
    const styleNote = book.age_range === '8-12'
      ? 'Écris pour un jeune public (8-12 ans) : phrases simples, vocabulaire accessible, ton dynamique.'
      : book.age_range === '13-17'
      ? 'Écris pour des adolescents : style rythmé, immersif, avec une légère tension narrative.'
      : 'Écris dans le style Pierre Bordage : 2e personne du singulier, phrases courtes et incisives, très immersif.'

    const prompt = isReturn
      ? `Tu es un auteur de livre LDVELH (Livre Dont Vous Êtes le Héros) en langue ${langLabel}.

LIVRE : "${book.title}" — ${book.theme}

Tu dois écrire un COURT TEXTE DE RETOUR (2-4 phrases, 30-60 mots maximum) affiché quand le lecteur revient à une section déjà visitée, après avoir choisi : "${choiceLabel}".

SECTION OÙ LE LECTEUR REVIENT (extrait) :
${sourceContent.slice(0, 600)}

SECTION D'OÙ IL VIENT (début) :
${targetContent.slice(0, 400)}

RÈGLES :
- Ce texte remplace la relecture complète de la section — il résume ce que le héros se rappelle ou observe en revenant
- Ton mémoriel, immersif : "Tu te souviens…", "De retour ici…", "La scène te revient…"
- ${styleNote}
- Ne révèle pas le contenu de la section suivante
- Utilise la 2e personne du singulier (tu/vous selon le style du livre)
- Réponds UNIQUEMENT avec le texte de retour, sans guillemets ni balises`
      : `Tu es un auteur de livre LDVELH (Livre Dont Vous Êtes le Héros) en langue ${langLabel}.

LIVRE : "${book.title}" — ${book.theme}

Tu dois écrire un COURT PARAGRAPHE DE TRANSITION (2-4 phrases, 30-60 mots maximum) qui s'insère entre deux sections quand le lecteur choisit : "${choiceLabel}".

SECTION DE DÉPART (extrait) :
${sourceContent.slice(0, 600)}

SECTION D'ARRIVÉE (début) :
${targetContent.slice(0, 400)}

RÈGLES :
- Ce texte apparaît APRÈS que le lecteur a fait son choix, AVANT le texte de la section d'arrivée
- Il doit rendre la transition fluide et naturelle (passage dans le couloir, trajet, réflexion intérieure, etc.)
- ${styleNote}
- Ne répète pas le contenu de la section d'arrivée
- Utilise la 2e personne du singulier (tu/vous selon le style du livre)
- Réponds UNIQUEMENT avec le texte de transition, sans guillemets ni balises`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

    if (isReturn) {
      await supabaseAdmin.from('choices').update({ return_text: text }).eq('id', choiceId)
      return NextResponse.json({ return_text: text })
    } else {
      await supabaseAdmin.from('choices').update({ transition_text: text }).eq('id', choiceId)
      return NextResponse.json({ transition: text })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Erreur inconnue' }, { status: 500 })
  }
}
