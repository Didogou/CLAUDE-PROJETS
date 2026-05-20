import { NextRequest, NextResponse } from 'next/server'
import { callMistral } from '@/lib/ai-utils'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * POST /api/sections/[id]/extract-image-prompt
 *
 * Extrait un prompt visuel court (1 phrase descriptive) depuis le contenu
 * narratif de la section, via Mistral (free tier). Sert à pré-remplir le
 * champ "Décris la scène" du Studio Designer (Phase A — création de la
 * base d'un Plan).
 *
 * Distinct de `/image-prompts/` qui sort 3 storyboards via Claude Haiku.
 * Ici : 1 prompt FR purement visuel, ~30 mots max, prêt à être traduit
 * EN par le bouton existant du panel.
 *
 * Body : aucun.
 * Réponse : { prompt: string }
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const { data: section, error } = await supabaseAdmin
      .from('sections')
      .select('content, summary')
      .eq('id', id)
      .single()
    if (error || !section) {
      return NextResponse.json({ error: 'Section introuvable' }, { status: 404 })
    }

    const content = (section.content as string | null)?.trim() ?? ''
    const summary = (section.summary as string | null)?.trim() ?? ''
    const source = content || summary
    if (!source) {
      return NextResponse.json({ error: 'Section sans contenu narratif' }, { status: 400 })
    }

    const systemPrompt = `Tu es un assistant qui extrait des descriptions visuelles d'images depuis du texte narratif.
Tu produis UNE phrase descriptive en français, focalisée UNIQUEMENT sur ce qui serait visible dans une illustration de la scène (lieu, lumière, atmosphère, éléments visibles).
RÈGLES STRICTES :
- Pas d'émotions ni de pensées de personnages (sauf si visibles via posture/expression)
- Pas d'éléments narratifs hors-champ ("la cliente attend depuis 20 min" → ignorer)
- Pas d'introduction ("Voici la scène : …") ni de conclusion
- ~25-40 mots, dense, factuel
- Format : une seule phrase qui décrit l'image, comme une légende d'illustration`

    const userPrompt = `Texte de la section :
"""
${source}
"""

${summary ? `Métadonnées (lieu, type) : ${summary}\n\n` : ''}Sors UNIQUEMENT la phrase descriptive, sans guillemets ni préfixe.`

    const raw = await callMistral(systemPrompt, userPrompt, 200)
    // Sanitize : retire guillemets entourants, sauts de ligne en trop, et
    // les bullets que Mistral ajoute parfois malgré l'instruction.
    const prompt = raw
      .trim()
      .replace(/^["'«»]\s*/, '')
      .replace(/\s*["'«»]$/, '')
      .replace(/^[-•*]\s*/, '')
      .replace(/\n+/g, ' ')
      .trim()

    if (!prompt) {
      return NextResponse.json({ error: 'Mistral a renvoyé une réponse vide' }, { status: 502 })
    }
    return NextResponse.json({ prompt })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/sections/[id]/extract-image-prompt POST]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
