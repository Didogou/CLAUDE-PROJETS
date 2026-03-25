import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 30

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: section } = await supabaseAdmin
    .from('sections')
    .select('number, content, summary')
    .eq('id', id)
    .single()

  if (!section) return NextResponse.json({ error: 'Section introuvable' }, { status: 404 })

  const source = section.content?.trim() || section.summary?.trim() || ''
  if (!source) return NextResponse.json({ error: 'Section sans contenu' }, { status: 400 })

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 900,
    messages: [{
      role: 'user',
      content: `Tu es un directeur artistique pour un jeu mobile "Dont Vous Êtes le Héros".
À partir de ce texte de section, découpe la scène en 4 plans visuels séquentiels (comme un storyboard).
Pour chaque plan, fournis :
- un prompt d'illustration en anglais (pour la génération IA)
- une description courte en français (pour le concepteur, 1 phrase)

Contraintes :
- 4 plans dans l'ordre chronologique
- Prompt anglais : 1 à 2 phrases, scène, atmosphère, éléments visuels, style illustration narrative
- Description française : courte et descriptive, ce qu'on voit dans l'image
- Réponds uniquement en JSON :
{
  "prompt1": "...", "fr1": "...",
  "prompt2": "...", "fr2": "...",
  "prompt3": "...", "fr3": "...",
  "prompt4": "...", "fr4": "..."
}

Texte de la section §${section.number} :
${source.slice(0, 1500)}`,
    }],
  })

  try {
    const raw = (message.content[0] as any).text?.trim() ?? ''
    const json = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(json)
    const prompts = [parsed.prompt1 ?? '', parsed.prompt2 ?? '', parsed.prompt3 ?? '', parsed.prompt4 ?? '']
    const prompts_fr = [parsed.fr1 ?? '', parsed.fr2 ?? '', parsed.fr3 ?? '', parsed.fr4 ?? '']
    return NextResponse.json({ prompts, prompts_fr })
  } catch {
    return NextResponse.json({ error: 'Réponse Claude invalide' }, { status: 500 })
  }
}
