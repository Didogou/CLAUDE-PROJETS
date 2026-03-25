import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const maxDuration = 120

function buildStyleGuide(mapStyle: string): string {
  const styles: Record<string, string> = {
    subway:  'Plan de métro style NYC/Tokyo. Fond #0d0d14. Lignes épaisses colorées (rouge, jaune, vert, bleu, orange) strokeWidth=4. Stations : cercles r=8 couleur de la ligne, bordure blanche 2px. Noms de station en blanc sans-serif 11px à côté. Tracés géométriques (45° ou orthogonaux). Titre du réseau en haut.',
    city:    'Carte de ville réaliste. Fond #111827. Rues : lignes grises claires strokeWidth=1.5. Avenues principales : blanc strokeWidth=2.5. Quartiers : zones rectangulaires semi-transparentes. Points d\'intérêt : cercles colorés selon type (rouge=danger, vert=allié, bleu=info). Noms en blanc 10px.',
    dungeon: 'Plan de donjon fantasy. Fond #0a0806. Murs : rectangles #3d2b1a remplis. Couloirs : chemins beige #c4a882 strokeWidth=3. Salles : polygones avec bordure dorée #8b6914. Portes : petits rectangles noirs barrés d\'une ligne. Lieux : icônes simples + texte sépia 10px.',
    forest:  'Carte de territoire sauvage, style parchemin. Fond #1a1204. Chemins : lignes brun clair sinueuses strokeWidth=2. Zones de forêt : cercles verts semi-transparents groupés. Rivières : chemins bleu #3a7bd5 strokeWidth=2. Lieux : cercles crème #e8d5a3 bordure brune. Textes italic serif #e8d5a3 11px. Rose des vents dans un coin.',
    sea:     'Carte nautique. Fond #030d1a. Mer : fond bleu sombre. Îles : polygones beige-vert #c4b896. Côtes : bordure sombre strokeWidth=1. Routes maritimes : pointillés blancs strokeWidth=1.5. Ports : ancre ⚓ ou cercle blanc. Vents/courants : flèches légères cyan. Textes blanc cassé sans-serif 10px.',
  }
  return styles[mapStyle] ?? 'Fond #0f0f14. Connexions colorées. Textes blancs 11px sans-serif.'
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: book } = await supabaseAdmin.from('books').select('*').eq('id', id).single()
  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })
  if (book.phase !== 'structure_generated') {
    return NextResponse.json({ error: 'La structure doit être générée avant la validation' }, { status: 409 })
  }

  // 1. Valider la structure
  const { error: phaseError } = await supabaseAdmin.from('books').update({ phase: 'structure_validated' }).eq('id', id)
  if (phaseError) return NextResponse.json({ error: phaseError.message }, { status: 500 })

  // 2. Générer la carte SVG si le livre en a une
  let mapGenerated = false
  if (book.map_style) {
    try {
      const { data: locations } = await supabaseAdmin.from('locations').select('*').eq('book_id', id)
      const locs = locations ?? []

      if (locs.length > 0) {
        const locationList = locs.map(l => `- ${l.icon} ${l.name}`).join('\n')
        const styleGuide = buildStyleGuide(book.map_style)

        const prompt = `Génère une carte SVG pour un livre d'aventure interactif. RÉPONDS UNIQUEMENT AVEC LE SVG.

Livre : "${book.title}" — ${book.theme}, ${book.context_type}
Type de carte : ${book.map_style}
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

        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 16000,
          messages: [{ role: 'user', content: prompt }],
        })

        const raw = message.content[0].type === 'text' ? message.content[0].text : ''
        const svgMatch = raw.match(/<svg[\s\S]*<\/svg>/i)
        const svg = svgMatch ? svgMatch[0] : (raw.indexOf('<svg') !== -1 ? raw.slice(raw.indexOf('<svg')) + '\n</svg>' : null)

        if (svg) {
          await supabaseAdmin.from('books').update({ map_svg: svg }).eq('id', id)
          mapGenerated = true
        }
      }
    } catch {
      // Carte non bloquante : on continue même si ça échoue
    }
  }

  return NextResponse.json({ success: true, map_generated: mapGenerated })
}
