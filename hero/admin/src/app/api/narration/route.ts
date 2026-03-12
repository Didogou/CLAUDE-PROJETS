import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODE_PROMPTS: Record<string, string> = {
  intensifier: `Tu es un éditeur littéraire expert en romans "Dont Vous Êtes le Héros".
Retravaille le texte suivant en mode INTENSIFIER :
- Découpe les longues phrases en phrases très courtes (5-12 mots)
- Commence par un verbe d'action ou une sensation physique
- Utilise des verbes forts et précis
- Ajoute 1-2 détails sensoriels (son, odeur, texture, lumière)
- Maintiens la 2ème personne du singulier au présent
- Conserve exactement les mêmes éléments narratifs, PNJ, lieux et choix
- Longueur similaire à l'original (±20%)
Réponds UNIQUEMENT avec le texte réécrit, sans commentaire.`,

  alléger: `Tu es un éditeur littéraire expert en romans "Dont Vous Êtes le Héros".
Retravaille le texte suivant en mode ALLÉGER (public 8-12 ans) :
- Vocabulaire simple et courant
- Phrases courtes et claires (8-15 mots max)
- Réduis les descriptions de violence (blessures légères)
- Ton encourageant, tension modérée
- Conserve l'aventure, l'intrigue et les éléments narratifs
- Maintiens la 2ème personne du singulier au présent
Réponds UNIQUEMENT avec le texte réécrit, sans commentaire.`,

  corriger: `Tu es un correcteur littéraire expert.
Corrige le texte suivant (orthographe, grammaire, fluidité) :
- Corrige toutes les fautes d'orthographe et de grammaire
- Améliore la fluidité et la cohérence
- Vérifie la concordance des temps (présent narratif)
- Ne change PAS le fond, le style global, ni la longueur
- Maintiens la 2ème personne du singulier
Réponds UNIQUEMENT avec le texte corrigé, sans commentaire.`,

  bordage: `Tu es Pierre Bordage, auteur de science-fiction et fantasy français.
Réécris le texte suivant dans ton style signature :
- 2ème personne du singulier, présent de l'indicatif
- Phrases très courtes entrecoupées de phrases plus longues pour le rythme
- Début in medias res : plonge immédiatement dans l'action ou la sensation
- Synesthésies : associe plusieurs sens dans une même image
- Tension croissante vers la fin, cliffhanger ou question ouverte
- Atmosphère immersive et sensorielle (sons, odeurs, lumières, textures)
- Conserve tous les éléments narratifs, PNJ, lieux et enjeux
- Longueur similaire à l'original (±20%)
Réponds UNIQUEMENT avec le texte réécrit, sans commentaire.`,

  résumé: `Tu es un éditeur littéraire expert en romans "Dont Vous Êtes le Héros".
À partir du texte suivant, génère UNE SEULE phrase résumé (maximum 12 mots) :
- À la 2ème personne : "Vous [verbe d'action] [contexte]"
- Capture l'action ou l'enjeu principal
- Exemples : "Vous affrontez le Garde de Fer devant les portes maudites"
- Exemples : "Vous déchiffrez l'énigme du sphinx pour fuir le labyrinthe"
Réponds UNIQUEMENT avec la phrase résumé, sans ponctuation finale, sans commentaire.`,
}

export async function POST(req: NextRequest) {
  try {
    const { content, mode } = await req.json()
    if (!content || !mode || !MODE_PROMPTS[mode]) {
      return NextResponse.json({ error: 'content et mode requis' }, { status: 400 })
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `${MODE_PROMPTS[mode]}\n\n---\n\n${content}`,
      }],
    })

    const result = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    return NextResponse.json({ result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
