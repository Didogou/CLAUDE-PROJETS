import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [{ data: book }, { data: sections }, { data: allChoices }] = await Promise.all([
    supabaseAdmin.from('books').select('title, theme, context_type, description').eq('id', id).single(),
    supabaseAdmin.from('sections').select('id, number, content, summary, is_ending, ending_type, trial').eq('book_id', id).order('number'),
    supabaseAdmin.from('choices').select('section_id, label, target_section_id, requires_trial').in(
      'section_id',
      // récupère tous les ids via sous-requête simulée
      (await supabaseAdmin.from('sections').select('id').eq('book_id', id)).data?.map(s => s.id) ?? []
    ),
  ])

  if (!book || !sections?.length) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  // Construire le graphe : section → choix → cible
  const choicesBySection = new Map<number, { label: string; target?: number; trial: boolean }[]>()
  const sectionById = new Map(sections.map(s => [s.id, s]))
  const sectionByNumber = new Map(sections.map(s => [s.number, s]))

  for (const choice of (allChoices ?? [])) {
    const sec = sectionById.get(choice.section_id)
    if (!sec) continue
    const target = choice.target_section_id ? sectionById.get(choice.target_section_id) : null
    if (!choicesBySection.has(sec.number)) choicesBySection.set(sec.number, [])
    choicesBySection.get(sec.number)!.push({
      label: choice.label,
      target: target?.number,
      trial: choice.requires_trial,
    })
  }

  // Trouver tous les chemins (DFS limité) depuis §1
  const endings = sections.filter(s => s.is_ending)

  // Construire le texte de l'histoire section par section (plus lisible que les chemins)
  const sectionLines = sections.map(s => {
    const choices = choicesBySection.get(s.number) ?? []
    const choiceStr = choices.length
      ? choices.map(c => `  → [${c.trial ? 'épreuve' : 'choix'}] "${c.label}"${c.target ? ` → §${c.target}` : ' (fin)' }`).join('\n')
      : ''
    const ending = s.is_ending ? ` [FIN : ${s.ending_type === 'victory' ? 'VICTOIRE' : 'MORT'}]` : ''
    const t = s.trial as any
    const trialStr = t
      ? (() => {
          const succ = t.success_section_id ? sectionById.get(t.success_section_id)?.number : null
          const fail = t.failure_section_id ? sectionById.get(t.failure_section_id)?.number : null
          return ` [ÉPREUVE:${t.type} | succès→${succ ? '§' + succ : 'NON DÉFINI'} | échec→${fail ? '§' + fail : 'NON DÉFINI'}]`
        })()
      : ''
    const text = s.summary || s.content?.slice(0, 200) || '(pas de contenu)'
    return `§${s.number}${ending}${trialStr}\n${text}${choiceStr ? '\n' + choiceStr : ''}`
  }).join('\n\n')

  const prompt = `Tu es un éditeur littéraire qui analyse un livre "Dont Vous Êtes le Héros".

Livre : "${book.title}" — ${book.theme}, ${book.context_type}
Sections : ${sections.length} | Fins : ${endings.length} (${endings.filter(e => (e as any).ending_type === 'victory').length} victoires, ${endings.filter(e => (e as any).ending_type === 'death').length} morts)

--- CONTENU DU LIVRE ---
${sectionLines}
--- FIN DU CONTENU ---

Ta mission : produire un RAPPORT D'ANALYSE NARRATIVE structuré ainsi :

## Résumé de l'histoire principale
(Décris le fil directeur du récit en 3-5 paragraphes — du début à la ou les fins principales. Explique qui est le héros, quel est l'enjeu, les grandes étapes de l'aventure.)

## Chemins alternatifs notables
(Liste les bifurcations importantes et ce qu'elles impliquent narrativement)

## Incohérences et problèmes détectés
(Signale tout ce qui cloche : ruptures de continuité, sections orphelines, contradictions dans l'univers, personnages qui disparaissent sans explication, logique cassée d'un choix, fins trop abruptes, sections sans choix qui ne sont pas des fins, etc. Si rien à signaler sur un point, écris "Aucun problème détecté.")

## Points forts
(Ce qui fonctionne bien dans la narration)

## Recommandations
(Suggestions concrètes pour améliorer la cohérence — maximum 5 points, triés par priorité)

Sois précis, cite les numéros de section (§N) quand tu pointes un problème.`

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })
    const message = await stream.finalMessage()
    const summary = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

    await supabaseAdmin.from('books').update({ story_analysis: summary }).eq('id', id)

    return NextResponse.json({ summary })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
