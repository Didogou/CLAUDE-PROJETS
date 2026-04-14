import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sectionIds = (await supabaseAdmin.from('sections').select('id').eq('book_id', id)).data?.map(s => s.id) ?? []

  const [{ data: book }, { data: sections }, { data: allChoices }, { data: allNpcs }, { data: allItems }] = await Promise.all([
    supabaseAdmin.from('books').select('title, theme, context_type, description').eq('id', id).single(),
    supabaseAdmin.from('sections').select('id, number, content, summary, is_ending, ending_type, trial, companion_npc_ids, items_on_scene, discussion_scene').eq('book_id', id).order('number'),
    supabaseAdmin.from('choices').select('section_id, label, target_section_id, requires_trial').in('section_id', sectionIds),
    supabaseAdmin.from('npcs').select('id, name, type, speech_style').eq('book_id', id),
    supabaseAdmin.from('items').select('id, name, item_type').eq('book_id', id),
  ])

  if (!book || !sections?.length) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const npcById = new Map((allNpcs ?? []).map(n => [n.id, n]))
  const itemById = new Map((allItems ?? []).map(i => [i.id, i]))
  const sectionById = new Map(sections.map(s => [s.id, s]))

  const choicesBySection = new Map<number, { label: string; target?: number; trial: boolean }[]>()
  for (const choice of (allChoices ?? [])) {
    const sec = sectionById.get(choice.section_id)
    if (!sec) continue
    const target = choice.target_section_id ? sectionById.get(choice.target_section_id) : null
    if (!choicesBySection.has(sec.number)) choicesBySection.set(sec.number, [])
    choicesBySection.get(sec.number)!.push({ label: choice.label, target: target?.number, trial: choice.requires_trial })
  }

  const endings = sections.filter(s => s.is_ending)

  const sectionLines = sections.map(s => {
    const parts: string[] = []

    // En-tête
    const ending = s.is_ending ? ` [FIN : ${s.ending_type === 'victory' ? 'VICTOIRE' : 'MORT'}]` : ''
    const t = s.trial as any
    const trialStr = t ? ` [ÉPREUVE:${t.type}${t.enemy_name ? ' vs ' + t.enemy_name : ''}]` : ''
    parts.push(`§${s.number}${ending}${trialStr}`)

    // Texte narratif
    parts.push(s.summary || s.content?.slice(0, 200) || '(pas de contenu)')

    // PNJ présents
    const companionIds: string[] = s.companion_npc_ids ?? []
    if (companionIds.length) {
      const names = companionIds.map(nid => {
        const n = npcById.get(nid)
        return n ? `${n.name} (${n.type})` : nid
      })
      parts.push(`👥 PNJ : ${names.join(', ')}`)
    }

    // Objets sur scène
    const sceneItems: any[] = s.items_on_scene ?? []
    if (sceneItems.length) {
      const names = sceneItems.map((si: any) => itemById.get(si.item_id)?.name ?? si.item_id)
      parts.push(`📦 Objets : ${names.join(', ')}`)
    }

    // Récompenses épreuve
    if (t?.item_rewards?.length) {
      parts.push(`🎁 Récompenses victoire : ${t.item_rewards.join(', ')}`)
    }

    // Discussion
    const disc = s.discussion_scene as any
    if (disc) {
      const npcName = npcById.get(disc.npc_id)?.name ?? disc.npc_id
      const discLines = [`💬 Discussion avec ${npcName} :`]
      discLines.push(`  ${npcName} : "${disc.npc_opening}"`)
      for (const c of (disc.choices ?? [])) {
        discLines.push(`  [${c.emotion_label}] Joueur : "${c.player_text}"`)
        discLines.push(`  ${npcName} : "${c.npc_response}"`)
        if (c.target_section_id) {
          discLines.push(`  → navigation`)
        }
        if (c.sub_choices?.length) {
          for (const sc of c.sub_choices) {
            discLines.push(`    [${sc.emotion_label}] Joueur : "${sc.player_text}"`)
            discLines.push(`    ${npcName} : "${sc.npc_response}"`)
            discLines.push(`    → navigation`)
          }
        }
      }
      parts.push(discLines.join('\n'))
    }

    // Choix de navigation
    const choices = choicesBySection.get(s.number) ?? []
    if (choices.length) {
      parts.push(choices.map(c => `  → [${c.trial ? 'épreuve' : 'choix'}] "${c.label}"${c.target ? ` → §${c.target}` : ' (fin)'}`).join('\n'))
    }

    return parts.join('\n')
  }).join('\n\n')

  const prompt = `Tu es un éditeur littéraire qui analyse un livre "Dont Vous Êtes le Héros".

Livre : "${book.title}" — ${book.theme}, ${book.context_type}
Sections : ${sections.length} | Fins : ${endings.length} (${endings.filter(e => (e as any).ending_type === 'victory').length} victoires, ${endings.filter(e => (e as any).ending_type === 'death').length} morts)

--- CONTENU COMPLET DU LIVRE ---
${sectionLines}
--- FIN DU CONTENU ---

Ta mission : produire un RAPPORT D'ANALYSE NARRATIVE structuré ainsi :

## Résumé de l'histoire principale
(Décris le fil directeur du récit en 3-5 paragraphes — du début à la ou les fins principales. Intègre les PNJ clés, les objets importants, les combats marquants et les discussions décisives.)

## Chemins alternatifs notables
(Liste les bifurcations importantes et ce qu'elles impliquent narrativement. Mentionne si les discussions orientent vers des chemins cohérents.)

## PNJ et leur rôle narratif
(Pour chaque PNJ présent, résume son rôle dans l'histoire — ennemi, allié, informateur. Signale si un PNJ apparaît dans une discussion mais semble incohérent avec son type ou son style.)

## Objets et leur utilité narrative
(Les objets trouvés ont-ils un sens dans l'histoire ? Sont-ils utilisés, récompensés, cohérents avec l'univers ?)

## Incohérences et problèmes détectés
(Signale tout ce qui cloche : ruptures de continuité, PNJ qui disparaissent, discussions dont les choix mènent au mauvais endroit, objets inutilisés, logique cassée. Cite les §N concernés. Si rien : "Aucun problème détecté.")

## Points forts
(Ce qui fonctionne bien dans la narration, les PNJ bien écrits, les discussions cohérentes)

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
