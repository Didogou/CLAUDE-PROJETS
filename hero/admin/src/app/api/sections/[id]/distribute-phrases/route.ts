import { NextRequest, NextResponse } from 'next/server'
import { streamMessageWithRetry, extractJson } from '@/lib/ai-utils'

export const maxDuration = 30

// POST { phrases: string[], imageDescriptions: string[] } → { distribution: string[][] }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params
  const body = await req.json() as { phrases?: string[]; imageDescriptions?: string[] }
  const phrases = body.phrases ?? []
  const imageDescriptions = body.imageDescriptions ?? []

  if (phrases.length === 0) {
    return NextResponse.json({ distribution: [] })
  }

  const nImages = Math.max(imageDescriptions.length, 1)

  if (nImages === 1) {
    return NextResponse.json({ distribution: [phrases] })
  }

  const phrasesBlock = phrases.map((p, i) => `[${i + 1}] ${p}`).join('\n')
  const imagesBlock = imageDescriptions.map((d, i) => `Image ${i + 1} : ${d || '(pas de description)'}`).join('\n')

  const systemPrompt = `Tu es un assistant de découpage narratif pour un roman graphique interactif. Tu répartis des phrases de texte entre des images de storyboard de façon à ce que chaque image illustre bien les phrases qui lui sont assignées. Tu respectes l'ordre chronologique des phrases. Tu réponds uniquement en JSON valide.`

  const userPrompt = `Voici ${phrases.length} phrase(s) à répartir sur ${nImages} image(s) de storyboard.

Les images (dans l'ordre chronologique de la scène) :
${imagesBlock}

Les phrases à distribuer (dans l'ordre du texte) :
${phrasesBlock}

Règles :
- Respecte l'ordre des phrases (pas de réorganisation)
- Chaque image doit recevoir au moins une phrase si possible
- Assigne plus de phrases aux images d'action/climax, moins aux images de transition
- Si une image a une description vide, donne-lui une part proportionnelle

Réponds UNIQUEMENT en JSON :
{
  "distribution": [
    ["phrase exacte 1", "phrase exacte 2"],
    ["phrase exacte 3"],
    ["phrase exacte 4", "phrase exacte 5"]
  ]
}

Les phrases dans "distribution" doivent être copiées mot pour mot depuis la liste fournie.`

  try {
    const msg = await streamMessageWithRetry({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const json = extractJson(raw)
    const parsed = JSON.parse(json)
    const distribution: string[][] = parsed.distribution ?? []
    while (distribution.length < nImages) distribution.push([])
    return NextResponse.json({ distribution: distribution.slice(0, nImages) })
  } catch {
    // Fallback : distribution proportionnelle automatique
    const n = phrases.length
    if (nImages === 2) {
      const n0 = Math.ceil(n * 0.5)
      return NextResponse.json({ distribution: [phrases.slice(0, n0), phrases.slice(n0)] })
    }
    const n0 = Math.ceil(n * 0.40)
    const n1 = Math.ceil(Math.min(n - n0, n * 0.35))
    const result: string[][] = [phrases.slice(0, n0), phrases.slice(n0, n0 + n1)]
    if (nImages === 3) {
      result.push(phrases.slice(n0 + n1))
    } else {
      const rest = phrases.slice(n0 + n1)
      const perImg = Math.ceil(rest.length / (nImages - 2))
      for (let i = 0; i < nImages - 2; i++) result.push(rest.slice(i * perImg, (i + 1) * perImg))
    }
    return NextResponse.json({ distribution: result })
  }
}
