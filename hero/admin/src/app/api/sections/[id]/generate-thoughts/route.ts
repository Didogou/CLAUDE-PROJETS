import { NextRequest, NextResponse } from 'next/server'
import { callMistral } from '@/lib/ai-utils'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 30

// POST { descriptions: string[] } → { thoughts: string[] }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as { descriptions?: string[] }

  // ── Charger la section ──────────────────────────────────────────────────────
  const { data: section } = await supabaseAdmin
    .from('sections')
    .select('number, content, summary, location_id, companion_npc_ids, trial, book_id')
    .eq('id', id)
    .single()

  if (!section) return NextResponse.json({ error: 'Section introuvable' }, { status: 404 })

  // ── Charger le livre + protagoniste ────────────────────────────────────────
  const { data: book } = await supabaseAdmin
    .from('books')
    .select('title, synopsis, protagonist_description, protagonist_npc_id')
    .eq('id', section.book_id)
    .single()

  let protagonistBlock = ''
  if (book?.protagonist_npc_id) {
    const { data: proto } = await supabaseAdmin
      .from('npcs')
      .select('name, description, appearance, origin, speech_style')
      .eq('id', book.protagonist_npc_id)
      .single()
    if (proto) {
      protagonistBlock = [
        `Protagoniste : ${proto.name}`,
        proto.description  ? `Description : ${proto.description}` : '',
        proto.appearance   ? `Apparence : ${proto.appearance}` : '',
        proto.origin       ? `Origine : ${proto.origin}` : '',
        proto.speech_style ? `Façon de parler : ${proto.speech_style}` : '',
      ].filter(Boolean).join('\n')
    }
  }
  if (!protagonistBlock && book?.protagonist_description) {
    protagonistBlock = `Protagoniste : ${book.protagonist_description}`
  }
  if (!protagonistBlock) protagonistBlock = 'Protagoniste : le joueur (personnage non défini)'

  // ── Charger la localisation ────────────────────────────────────────────────
  let locationName = ''
  if (section.location_id) {
    const { data: loc } = await supabaseAdmin
      .from('locations')
      .select('name')
      .eq('id', section.location_id)
      .single()
    locationName = loc?.name ?? ''
  }

  // ── Charger les PNJ présents ───────────────────────────────────────────────
  const npcIds: string[] = [
    ...((section.companion_npc_ids as string[]) ?? []),
    ...(section.trial?.npc_id ? [section.trial.npc_id] : []),
  ].filter(Boolean)

  let npcBlock = ''
  if (npcIds.length > 0) {
    const { data: npcs } = await supabaseAdmin
      .from('npcs')
      .select('name, type, description')
      .in('id', npcIds)
    if (npcs?.length) {
      npcBlock = 'Personnages présents : ' + npcs.map(n => `${n.name} (${n.type}${n.description ? ' — ' + n.description.slice(0, 60) : ''})`).join(', ')
    }
  }

  const sectionText = section.content?.trim() || section.summary?.trim() || ''
  const descriptions = body.descriptions ?? []

  // ── Construire le prompt ───────────────────────────────────────────────────
  const systemPrompt = `Tu écris les pensées d'un gamin du Bronx, pas d'un romancier. Langage de la rue, cru, direct. Pas de métaphore littéraire, pas de style. Juste ce qui lui traverse la tête en une seconde — argot possible, syntaxe cassée, mots coupés. Une seule pensée courte, brute, vraie. Première personne, présent. Langue : français street, pas français soutenu.`

  const plansBlock = descriptions.length > 0
    ? descriptions.map((d, i) => `Plan ${i + 1} : ${d || '(pas de description)'}`).join('\n')
    : 'Plan 1, Plan 2, Plan 3 (progression chronologique de la scène)'

  const userPrompt = `${protagonistBlock}

Livre : "${book?.title ?? 'Inconnu'}"${book?.synopsis ? `\nSynopsis : ${book.synopsis.slice(0, 200)}` : ''}

Section §${section.number}${locationName ? ` — Lieu : ${locationName}` : ''}
${npcBlock ? npcBlock + '\n' : ''}
Texte de la section :
${sectionText.slice(0, 800)}

Les 3 plans storyboard de cette scène (ordre chronologique) :
${plansBlock}

Génère une pensée du protagoniste pour chacun des 3 plans. Chaque pensée : UNE seule phrase max, 3 à 8 mots, langage de la rue. Pas de guillemets. Exemples de style : "Ces gars-là ils cherchent", "Je me casse", "Y'a un truc qui colle pas", "Bougez pas", "Mon sang il refroidit".

Réponds UNIQUEMENT en JSON :
{
  "thought1": "...",
  "thought2": "...",
  "thought3": "..."
}`

  try {
    const raw = await callMistral(systemPrompt, userPrompt, 400)
    const json = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(json)
    const thoughts = [
      parsed.thought1?.trim() ?? '',
      parsed.thought2?.trim() ?? '',
      parsed.thought3?.trim() ?? '',
    ]
    return NextResponse.json({ thoughts })
  } catch {
    return NextResponse.json({ error: 'Réponse Mistral invalide' }, { status: 500 })
  }
}
