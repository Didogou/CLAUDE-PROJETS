import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropic } from '@/lib/ai-utils'

// Mots par minute selon le public
const WPM: Record<string, number> = {
  '8-12':  140,
  '13-17': 190,
  '18+':   240,
}

// Secondes de décision par type de section (narration avec choix uniquement)
const DECISION_TIME: Record<string, number> = {
  Narration:  30,
  Dialogue:   40,  // plus de contexte à traiter
  Énigme:     50,  // réfléchir
  default:    30,
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function readingSeconds(words: number, ageRange: string): number {
  const wpm = WPM[ageRange] ?? 200
  return Math.max(5, Math.ceil((words / wpm) * 60))
}

function sectionTypeLabel(s: any): string {
  if (s.is_ending) return s.ending_type === 'victory' ? 'Victoire' : 'Mort'
  if (s.trial) {
    const map: Record<string, string> = {
      combat: 'Combat', magie: 'Magie', agilite: 'Agilité',
      intelligence: 'Énigme', chance: 'Chance', crochetage: 'Crochetage', dialogue: 'Dialogue',
    }
    return map[s.trial.type] ?? 'Épreuve'
  }
  return 'Narration'
}

const TRIAL_TYPES = new Set(['Combat', 'Magie', 'Agilité', 'Chance', 'Crochetage'])

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: book } = await supabaseAdmin
    .from('books').select('title, theme, age_range, context_type').eq('id', id).single()
  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const { data: sections } = await supabaseAdmin
    .from('sections')
    .select('id, number, content, trial, is_ending, ending_type')
    .eq('book_id', id)
    .order('number')

  if (!sections?.length) return NextResponse.json({ error: 'Aucune section' }, { status: 400 })

  // Récupérer les PNJ pour générer les initiative_text
  const { data: npcs } = await supabaseAdmin
    .from('npcs').select('name, type, description, loot').eq('book_id', id)
  const npcByName = new Map((npcs ?? []).map(n => [n.name.toLowerCase(), n]))

  const updates: { id: string; reading_time: number; decision_time: number | null; initiative_text: string | null }[] = []

  // Sections combat qui ont un ennemi → générer initiative_text par batch
  const combatSections = sections.filter(s => s.trial?.type === 'combat' && s.trial?.enemy_name)
  let initiativeMap = new Map<string, string>()

  if (combatSections.length > 0) {
    const items = combatSections.map(s => {
      const npc = npcByName.get((s.trial.enemy_name ?? '').toLowerCase())
      return `§${s.number} — Ennemi : ${s.trial.enemy_name}${npc?.description ? ` (${npc.description.slice(0, 80)})` : ''}${npc?.loot ? ` — Armement : ${npc.loot.slice(0, 60)}` : ''}`
    }).join('\n')

    const isTu = true // default, could read from book
    const addressForm = isTu ? 'tu' : 'vous'
    const prompt = `Tu écris pour le livre "${book.title}" (${book.theme}, ${book.context_type}, ${book.age_range} ans).

Pour chaque section de combat ci-dessous, écris UNE phrase courte et percutante (20-35 mots) décrivant que l'ennemi a pris l'initiative pendant que le joueur hésitait. L'ennemi agit EN PREMIER — il attaque, dégaine, bondit, tire, lance un sort, etc. — selon son type et son armement. Utilise l'adresse "${addressForm}".

Exemples :
- "Pendant que ${addressForm === 'tu' ? 'tu hésites' : 'vous hésitez'}, le garde dégaine son épée et charge sans prévenir."
- "La Veuve Noire n'attend pas — elle lève son pistolet et tire avant que ${addressForm === 'tu' ? 'tu puisses' : 'vous puissiez'} réagir."
- "L'ogre grogne et ${addressForm === 'tu' ? 'te' : 'vous'} projette contre le mur d'un revers brutal."

Sections :
${items}

Réponds UNIQUEMENT avec du JSON brut : [{"number": 3, "text": "..."}, ...]`

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const jsonMatch = raw.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { number: number; text: string }[]
        for (const item of parsed) {
          const sec = combatSections.find(s => s.number === item.number)
          if (sec && item.text?.trim()) initiativeMap.set(sec.id, item.text.trim())
        }
      }
    } catch {
      // non bloquant — initiative_text reste null
    }
  }

  for (const s of sections) {
    const typeLabel = sectionTypeLabel(s)
    const words = countWords(s.content ?? '')
    const reading_time = words > 0 ? readingSeconds(words, book.age_range) : null

    // Pas de decision_time pour les épreuves, les fins, et les sections sans texte
    const isEpreuve = TRIAL_TYPES.has(typeLabel) || typeLabel === 'Épreuve'
    const isEnding = typeLabel === 'Victoire' || typeLabel === 'Mort'
    const decision_time = (isEpreuve || isEnding || !reading_time)
      ? null
      : (DECISION_TIME[typeLabel] ?? DECISION_TIME.default)

    const initiative_text = initiativeMap.get(s.id) ?? null

    updates.push({ id: s.id, reading_time: reading_time ?? 10, decision_time, initiative_text })
  }

  // Sauvegarder par batch
  const BATCH = 50
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH)
    await Promise.all(batch.map(u =>
      supabaseAdmin.from('sections').update({
        reading_time:   u.reading_time,
        decision_time:  u.decision_time,
        initiative_text: u.initiative_text,
      }).eq('id', u.id)
    ))
  }

  return NextResponse.json({
    updated: updates.length,
    with_initiative: initiativeMap.size,
  })
}
