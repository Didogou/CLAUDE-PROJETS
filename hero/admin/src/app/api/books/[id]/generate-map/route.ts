import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function buildStyleGuide(mapStyle: string): string {
  const styles: Record<string, string> = {
    'subway':  `Plan de métro style NYC/Tokyo. Fond #0d0d14. Lignes épaisses colorées (rouge, jaune, vert, bleu, orange) strokeWidth=4. Stations : cercles r=8 couleur de la ligne, bordure blanche 2px. Noms de station en blanc sans-serif 11px à côté. Tracés géométriques (45° ou orthogonaux). Titre du réseau en haut.`,
    'city':    `Carte de ville réaliste. Fond #111827. Rues : lignes grises claires strokeWidth=1.5. Avenues principales : blanc strokeWidth=2.5. Quartiers : zones rectangulaires semi-transparentes. Points d'intérêt : cercles colorés selon type (rouge=danger, vert=allié, bleu=info). Noms en blanc 10px.`,
    'dungeon': `Plan de donjon fantasy. Fond #0a0806. Murs : rectangles #3d2b1a remplis. Couloirs : chemins beige #c4a882 strokeWidth=3. Salles : polygones avec bordure dorée #8b6914. Portes : petits rectangles noirs barrés d'une ligne. Lieux : icônes simples + texte sépia 10px.`,
    'forest':  `Carte de territoire sauvage, style parchemin. Fond #1a1204. Chemins : lignes brun clair sinueuses strokeWidth=2. Zones de forêt : cercles verts semi-transparents groupés. Rivières : chemins bleu #3a7bd5 strokeWidth=2. Lieux : cercles crème #e8d5a3 bordure brune. Textes italic serif #e8d5a3 11px. Rose des vents dans un coin.`,
    'sea':     `Carte nautique. Fond #030d1a. Mer : fond bleu sombre. Îles : polygones beige-vert #c4b896. Côtes : bordure sombre strokeWidth=1. Routes maritimes : pointillés blancs strokeWidth=1.5. Ports : ancre ⚓ ou cercle blanc. Vents/courants : flèches légères cyan. Textes blanc cassé sans-serif 10px.`,
  }
  return styles[mapStyle] ?? 'Fond #0f0f14. Connexions colorées. Textes blancs 11px sans-serif.'
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: book } = await supabaseAdmin.from('books').select('*').eq('id', id).single()
  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const { data: locations } = await supabaseAdmin.from('locations').select('*').eq('book_id', id)
  const locs = locations ?? []
  if (locs.length === 0) return NextResponse.json({ error: 'Aucun lieu à cartographier' }, { status: 400 })

  const locationList = locs.map(l => `- ${l.icon} ${l.name}`).join('\n')
  const mapStyle: string = book.map_style ?? 'city'
  const styleGuide = buildStyleGuide(mapStyle)

  const prompt = `Génère une carte SVG pour un livre d'aventure interactif. RÉPONDS UNIQUEMENT AVEC LE SVG.

Livre : "${book.title}" — ${book.theme}, ${book.context_type}
Type de carte : ${mapStyle}
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
