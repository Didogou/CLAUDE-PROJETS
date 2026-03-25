import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateText } from '@/lib/ai-utils'

export const maxDuration = 30

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: book } = await supabaseAdmin
    .from('books')
    .select('title, theme, context_type, age_range, illustration_style, synopsis, story_analysis, intro_text, description, protagonist_description')
    .eq('id', id)
    .single()

  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const narrative = book.synopsis?.trim() || book.story_analysis?.trim() || book.intro_text?.trim() || book.description?.trim()
  if (!narrative) return NextResponse.json({ error: 'Aucun synopsis disponible (générez d\'abord un synopsis)' }, { status: 400 })

  const styleHints: Record<string, string> = {
    realistic:   'digital painting, dramatic lighting, photorealistic details',
    manga:       'manga art style, strong inking, screen tones, dynamic composition',
    bnw:         'black and white ink illustration, high contrast, crosshatching',
    watercolor:  'watercolor painting, soft washes, delicate transparency',
    comic:       'ligne claire Franco-Belgian comics style, clean outlines, flat colors',
    dark_fantasy:'dark fantasy oil painting, Frazetta-inspired, deep shadows, gritty textures',
    pixel:       '16-bit pixel art, retro video game style, limited color palette',
  }
  const styleHint = styleHints[book.illustration_style ?? 'realistic'] ?? styleHints.realistic

  const protagonistLine = book.protagonist_description?.trim()
    ? `\nPersonnage principal : ${book.protagonist_description.trim()}`
    : ''

  const systemPrompt = `Tu es un directeur artistique spécialisé en illustration de couvertures de livres interactifs (Dont Vous Êtes le Héros). Tu génères des prompts d'illustration en anglais pour Stable Diffusion / FLUX.`

  const userPrompt = `Génère un prompt d'illustration pour la couverture de ce livre DYEH.

**Titre :** ${book.title}
**Genre / Thème :** ${book.theme} — ${book.context_type}
**Public :** ${book.age_range} ans
**Style visuel :** ${styleHint}${protagonistLine}

**Synopsis / Résumé narratif :**
${narrative.slice(0, 3000)}

---

**Contraintes du prompt :**
- En anglais uniquement
- 3 à 5 phrases, denses et précises
- Décrire : la scène centrale (action ou tension dramatique), le personnage principal s'il est présent, les éléments de décor clés, l'ambiance lumineuse et chromatique, l'atmosphère émotionnelle
- Intégrer le style visuel demandé : ${styleHint}
- Key art de couverture, composition verticale (portrait), point focal central
- Pas de texte, pas de titre, pas de bande dessinée multi-cases, pas de marques
- Finir par : "${styleHint}, book cover art, dramatic composition, no text"

Retourne UNIQUEMENT le prompt, sans commentaire, sans guillemets.`

  try {
    const prompt = await generateText('claude', systemPrompt, userPrompt, 400)
    return NextResponse.json({ prompt: prompt.trim() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
