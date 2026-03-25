import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Mistral } from '@mistralai/mistralai'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Réutilise le même prompt que /api/narration pour le mode "bordage"
const PROMPT = `Tu es Pierre Bordage, auteur de science-fiction et fantasy français.
Réécris le texte suivant dans ton style signature :
- 2ème personne du singulier, présent de l'indicatif
- Phrases très courtes entrecoupées de phrases plus longues pour le rythme
- Début in medias res : plonge immédiatement dans l'action ou la sensation
- Synesthésies : associe plusieurs sens dans une même image
- Tension croissante vers la fin, cliffhanger ou question ouverte
- Atmosphère immersive et sensorielle (sons, odeurs, lumières, textures)
- Conserve tous les éléments narratifs, PNJ, lieux et enjeux
- Longueur similaire à l'original (±20%)
Réponds UNIQUEMENT avec le texte réécrit, sans commentaire.`

async function callMistral(prompt: string, content: string): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('Clé MISTRAL_API_KEY non configurée dans .env.local')

  const client = new Mistral({ apiKey })
  const res = await client.chat.complete({
    model: 'mistral-large-latest',
    maxTokens: 4000,
    messages: [{ role: 'user', content: `${prompt}\n\n---\n\n${content}` }],
  })
  return (res.choices?.[0]?.message?.content as string ?? '').trim()
}

export async function POST(req: NextRequest) {
  try {
    const { content, mode = 'bordage', skipClaude = false, skipMistral = false } = await req.json()
    if (!content) return NextResponse.json({ error: 'content requis' }, { status: 400 })

    const modePrompts: Record<string, string> = {
      bordage: PROMPT,
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
    }

    const prompt = modePrompts[mode] ?? PROMPT

    // Appels en parallèle — on saute le modèle qui a déjà généré le texte
    const [claudeResult, mistralResult] = await Promise.allSettled([
      skipClaude
        ? Promise.resolve(null)
        : anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 4000,
            messages: [{ role: 'user', content: `${prompt}\n\n---\n\n${content}` }],
          }).then(m => m.content[0].type === 'text' ? m.content[0].text.trim() : ''),
      skipMistral
        ? Promise.resolve(null)
        : callMistral(prompt, content),
    ])

    return NextResponse.json({
      claude: claudeResult.status === 'fulfilled' ? claudeResult.value : null,
      claudeError: claudeResult.status === 'rejected' ? claudeResult.reason?.message : null,
      mistral: mistralResult.status === 'fulfilled' ? mistralResult.value : null,
      mistralError: mistralResult.status === 'rejected' ? mistralResult.reason?.message : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
