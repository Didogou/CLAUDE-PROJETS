import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function buildStyleGuide(theme: string): string {
  const styles: Record<string, string> = {
    'Contemporain': `Plan de métro NYC. Fond #0d0d14. Lignes colorées (rouge, jaune, vert, bleu, orange) strokeWidth=3. Stations : cercles r=7 couleur ligne, bordure blanche 1.5px. Noms en blanc sans-serif 11px. Pas de filtres complexes.`,
    'Fantasy': `Carte parchemin fantasy. Fond #1e1508. Routes brun #8B4513 strokeWidth=2. Lieux : cercles sépia. Textes serif italic #e8d5a3 11px. Rose des vents simple dans un coin.`,
    'Science-Fiction': `Carte holographique. Fond #020810. Connexions cyan #00ffff strokeWidth=1.5. Stations : cercles cyan. Textes monospace cyan 10px.`,
    'Horreur': `Carte gothique. Fond #080306. Connexions rouge sang strokeWidth=2. Marqueurs croix rouge-brun. Textes gris pâle serif 11px.`,
    'Policier': `Tableau détective. Fond #0e0e18. Connexions rouge #cc3333 strokeWidth=1.5. Épingles colorées. Textes blanc cassé monospace 10px.`,
  }
  return styles[theme] ?? 'Fond #0f0f14. Connexions colorées. Textes blancs 11px sans-serif.'
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: book } = await supabaseAdmin.from('books').select('*').eq('id', id).single()
  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const { data: locations } = await supabaseAdmin.from('locations').select('*').eq('book_id', id)
  const locs = locations ?? []
  if (locs.length === 0) return NextResponse.json({ error: 'Aucun lieu à cartographier' }, { status: 400 })

  const locationList = locs.map(l => `- ${l.icon} ${l.name}`).join('\n')
  const styleGuide = buildStyleGuide(book.theme)

  const prompt = `Génère une carte SVG pour un livre d'aventure interactif. RÉPONDS UNIQUEMENT AVEC LE SVG.

Livre : "${book.title}" — ${book.theme}, ${book.context_type}
Inspiration : ${book.description ?? '(aucune)'}

Lieux (${locs.length}) :
${locationList}

Style : ${styleGuide}

RÈGLES STRICTES :
- SVG CONCIS, moins de 8000 caractères au total
- Commence par : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 560" width="800" height="560">
- Termine par : </svg>
- Pas de <defs> complexes, pas de filtres blur/glow (trop verbeux)
- Chaque lieu : forme simple (circle ou rect) + texte label
- Relier les lieux proches avec des <line> ou <path> simples
- Titre du livre en haut de la carte
- Aucun texte avant ou après le SVG`

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    })
    const message = await stream.finalMessage()

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    // Extraire le SVG (peut être entouré de texte ou balises markdown)
    let svg = raw
    const svgMatch = raw.match(/<svg[\s\S]*<\/svg>/i)
    if (!svgMatch) {
      // Essayer de le fermer manuellement si tronqué
      const start = raw.indexOf('<svg')
      if (start === -1) return NextResponse.json({ error: 'Pas de SVG dans la réponse. Début : ' + raw.slice(0, 300) }, { status: 500 })
      svg = raw.slice(start) + '\n</svg>'
    } else {
      svg = svgMatch[0]
    }

    const { error } = await supabaseAdmin.from('books').update({ map_svg: svg }).eq('id', id)
    if (error) throw error

    return NextResponse.json({ svg })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
