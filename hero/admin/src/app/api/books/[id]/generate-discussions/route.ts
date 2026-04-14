import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { callMistral, generateText, fixJsonControlChars, extractJson } from '@/lib/ai-utils'

export const maxDuration = 300

function enc(obj: any) { return `data: ${JSON.stringify(obj)}\n\n` }

async function insertChoicesRecursive(choices: any[], sceneId: string, parentId: string | null) {
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i]
    const { data: inserted, error } = await supabaseAdmin.from('discussion_choices').insert({
      scene_id: sceneId,
      parent_id: parentId,
      sort_order: i,
      player_text: c.player_text ?? null,
      emotion_label: c.emotion_label ?? null,
      npc_response: c.npc_response ?? null,
      target_section_id: c.target_section_id ?? null,
      condition_item: c.condition_item ?? null,
    }).select('id').single()
    if (error || !inserted) continue
    if (c.sub_choices?.length) await insertChoicesRecursive(c.sub_choices, sceneId, inserted.id)
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: book } = await supabaseAdmin
    .from('books')
    .select('title, theme, age_range, synopsis, protagonist_description, address_form')
    .eq('id', id).single()
  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const { data: sections } = await supabaseAdmin
    .from('sections')
    .select('id, number, summary, content, companion_npc_ids, trial')
    .eq('book_id', id)
    .not('companion_npc_ids', 'eq', '{}')
    .not('content', 'is', null)
    .order('number')

  const eligible = (sections ?? []).filter(
    (s: any) => Array.isArray(s.companion_npc_ids) && s.companion_npc_ids.length > 0 && s.content?.trim()
  )

  if (eligible.length === 0) {
    return NextResponse.json({ error: 'Aucune section éligible' }, { status: 400 })
  }

  const { data: allNpcs } = await supabaseAdmin
    .from('npcs')
    .select('id, name, type, speech_style, dialogue_intro')
    .eq('book_id', id)
    .in('type', ['allié', 'neutre'])
  const npcById = new Map((allNpcs ?? []).map((n: any) => [n.id, n]))

  // Charger toutes les sections du livre (pour les targets)
  const { data: allSections } = await supabaseAdmin
    .from('sections')
    .select('id, number, summary')
    .eq('book_id', id)
  const sectionById = new Map((allSections ?? []).map((s: any) => [s.id, s]))

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => controller.enqueue(new TextEncoder().encode(enc(obj)))
      send({ type: 'start', total: eligible.length })

      let done = 0, failed = 0

      for (const section of eligible) {
        // Collecter sections cibles (choix normaux + trial)
        const { data: navChoices } = await supabaseAdmin
          .from('choices')
          .select('id, label, target_section_id')
          .eq('section_id', section.id)
          .order('sort_order')

        const targetSectionIds = new Set<string>()
        for (const c of navChoices ?? []) { if (c.target_section_id) targetSectionIds.add(c.target_section_id) }
        const trial = section.trial as any
        if (trial?.success_section_id) targetSectionIds.add(trial.success_section_id)
        if (trial?.failure_section_id) targetSectionIds.add(trial.failure_section_id)

        if (targetSectionIds.size === 0) {
          send({ type: 'skip', number: section.number, reason: 'aucune section cible' })
          continue
        }

        const targetSections = [...targetSectionIds].map(sid => sectionById.get(sid)).filter(Boolean)

        const npcs = (section.companion_npc_ids as string[]).map(nid => npcById.get(nid)).filter(Boolean) as any[]
        if (npcs.length === 0) {
          send({ type: 'skip', number: section.number, reason: 'PNJ introuvables' })
          continue
        }

        const sceneText = section.content?.trim() || section.summary?.trim() || ''

        const structurePrompt = `Tu es l'architecte narratif d'un livre-jeu interactif.

LIVRE : "${book.title}" — ${book.theme}
PUBLIC : ${book.age_range} ans
PROTAGONISTE : ${book.protagonist_description || 'le héros'}
ADRESSE : ${book.address_form === 'tu' ? 'tutoiement' : 'vouvoiement'}

SECTION §${section.number} :
${sceneText.slice(0, 600)}

PNJ compagnons disponibles :
${npcs.map((n: any) => `- ${n.name} (id: ${n.id}) — style : ${n.speech_style || 'non défini'}`).join('\n')}

Sections cibles disponibles (target_section_id) :
${targetSections.map((s: any) => `- id: "${s.id}" → §${s.number} — "${(s.summary ?? '').slice(0, 60)}"`).join('\n')}

OBJECTIF : Scène de discussion en 2 temps.
- PNJ ouvre (npc_opening) + 2-3 choix joueur
- Si PNJ d'accord → target_section_id direct
- Si PNJ résiste → sub_choices, PNJ capitule toujours au 2e tour
- Chaque terminal a un target_section_id parmi les ids listés

Réponds UNIQUEMENT en JSON valide :
{"npc_id":"...","npc_opening":"...","outcome_thought":"pensée finale courte","choices":[{"id":"c1","player_text":"...","emotion_label":"...","npc_response":"...","target_section_id":"id facultatif","sub_choices":[{"id":"sc1","player_text":"...","emotion_label":"...","npc_response":"le PNJ cède","target_section_id":"id obligatoire"}]}]}`

        let structure: { npc_id: string; npc_opening: string; outcome_thought?: string; choices: any[] }
        try {
          const raw = await generateText('claude', '', structurePrompt, 1500)
          structure = JSON.parse(fixJsonControlChars(extractJson(raw)))
        } catch {
          send({ type: 'error', number: section.number, reason: 'erreur structure Claude' })
          failed++; continue
        }

        const validNpcIds = new Set(npcs.map((n: any) => n.id))
        const validateSectionId = (sid: any) => targetSectionIds.has(sid) ? sid : undefined
        if (!validNpcIds.has(structure.npc_id)) structure.npc_id = npcs[0].id

        structure.choices = (structure.choices ?? []).map((c: any) => ({
          ...c,
          target_section_id: validateSectionId(c.target_section_id),
          sub_choices: Array.isArray(c.sub_choices)
            ? c.sub_choices.map((sc: any) => ({
                ...sc,
                target_section_id: validateSectionId(sc.target_section_id) ?? [...targetSectionIds][0],
              }))
            : undefined,
        })).filter((c: any) => c.target_section_id || c.sub_choices?.length)

        if (structure.choices.length === 0) {
          send({ type: 'error', number: section.number, reason: 'aucun choix valide' })
          failed++; continue
        }

        // Mistral stylise les répliques
        const selectedNpc = npcs.find((n: any) => n.id === structure.npc_id)!
        const textItems: string[] = [`OPENING: "${structure.npc_opening}"`]
        structure.choices.forEach((c: any, ci: number) => {
          textItems.push(`NPC_RESPONSE[${ci}]: "${c.npc_response}"`)
          c.sub_choices?.forEach((sc: any, sci: number) => {
            textItems.push(`NPC_CAPITULATION[${ci}][${sci}]: "${sc.npc_response}"`)
          })
        })

        let mistralParsed: any = {}
        try {
          const mistralRaw = await callMistral(
            'Tu es un auteur de livres-jeux. Réécris les répliques dans le style du PNJ. Réponds uniquement en JSON.',
            `PNJ : ${selectedNpc.name}\nStyle : ${selectedNpc.speech_style || 'naturel'}\nThème : ${book.theme}\n\nRÈGLES : Ne jamais écrire en MAJUSCULES. 1-2 phrases max.\n\n${textItems.join('\n')}\n\nRéponds UNIQUEMENT : {"OPENING":"...","NPC_RESPONSE":["..."],"NPC_CAPITULATION":[["..."]]}`,
            1500
          )
          mistralParsed = JSON.parse(fixJsonControlChars(extractJson(mistralRaw)))
        } catch { /* fallback Claude */ }

        const getStr = (val: any) => (typeof val === 'string' && val.trim() ? val.trim() : null)

        const finalChoices = structure.choices.map((c: any, ci: number) => ({
          id: c.id ?? `c${ci}`,
          player_text: c.player_text,
          emotion_label: c.emotion_label,
          npc_response: getStr(mistralParsed?.NPC_RESPONSE?.[ci]) ?? c.npc_response,
          ...(c.target_section_id ? { target_section_id: c.target_section_id } : {}),
          ...(c.sub_choices?.length ? {
            sub_choices: c.sub_choices.map((sc: any, sci: number) => ({
              id: sc.id ?? `sc${ci}_${sci}`,
              player_text: sc.player_text,
              emotion_label: sc.emotion_label,
              npc_response: getStr(mistralParsed?.NPC_CAPITULATION?.[ci]?.[sci]) ?? sc.npc_response,
              ...(sc.target_section_id ? { target_section_id: sc.target_section_id } : {}),
            }))
          } : {}),
        }))

        const discussion_scene = {
          npc_id: structure.npc_id,
          npc_opening: getStr(mistralParsed?.OPENING) ?? structure.npc_opening,
          outcome_thought: getStr(structure.outcome_thought) ?? undefined,
          choices: finalChoices,
        }

        // Sauvegarder dans les tables relationnelles
        const { data: scene, error: sceneErr } = await supabaseAdmin
          .from('discussion_scenes')
          .upsert({ section_id: section.id, ...discussion_scene, choices: undefined }, { onConflict: 'section_id' })
          .select('id').single()

        if (sceneErr || !scene) {
          send({ type: 'error', number: section.number, reason: sceneErr?.message ?? 'erreur scene' })
          failed++; continue
        }

        await supabaseAdmin.from('discussion_choices').delete().eq('scene_id', scene.id)
        await insertChoicesRecursive(finalChoices, scene.id, null)

        // Cache JSONB simulateur
        await supabaseAdmin.from('sections')
          .update({ discussion_scene: { scene_id: scene.id, ...discussion_scene } })
          .eq('id', section.id)

        done++
        send({ type: 'progress', number: section.number, done, total: eligible.length, failed })
      }

      send({ type: 'done', done, failed, total: eligible.length })
      controller.close()
    },
  })

  return new NextResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  })
}
