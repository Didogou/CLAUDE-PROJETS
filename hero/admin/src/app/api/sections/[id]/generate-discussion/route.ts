import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { callMistral, generateText, fixJsonControlChars, extractJson } from '@/lib/ai-utils'

export const maxDuration = 60

// Helper: insert choices recursively into discussion_choices table
async function insertChoicesRecursive(
  choices: any[],
  sceneId: string,
  parentId: string | null,
): Promise<void> {
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
    if (c.sub_choices?.length) {
      await insertChoicesRecursive(c.sub_choices, sceneId, inserted.id)
    }
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: section } = await supabaseAdmin
    .from('sections')
    .select('id, number, summary, content, book_id, companion_npc_ids, trial')
    .eq('id', id)
    .single()
  if (!section) return NextResponse.json({ error: 'Section introuvable' }, { status: 404 })

  const { data: book } = await supabaseAdmin
    .from('books')
    .select('title, theme, age_range, synopsis, protagonist_description, address_form')
    .eq('id', section.book_id)
    .single()
  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  // Collecter les sections cibles possibles (choix normaux + trial success/failure)
  const { data: navChoices } = await supabaseAdmin
    .from('choices')
    .select('id, label, target_section_id')
    .eq('section_id', id)
    .order('sort_order')

  const targetSectionIds = new Set<string>()
  for (const c of navChoices ?? []) {
    if (c.target_section_id) targetSectionIds.add(c.target_section_id)
  }
  const trial = section.trial as any
  if (trial?.success_section_id) targetSectionIds.add(trial.success_section_id)
  if (trial?.failure_section_id) targetSectionIds.add(trial.failure_section_id)

  if (targetSectionIds.size === 0) {
    return NextResponse.json({ error: 'Cette section n\'a aucune section cible (ni choix, ni épreuve)' }, { status: 400 })
  }

  // Charger les sections cibles pour les afficher dans le prompt
  const { data: targetSections } = await supabaseAdmin
    .from('sections')
    .select('id, number, summary')
    .in('id', [...targetSectionIds])

  const companionIds: string[] = section.companion_npc_ids ?? []
  let npcs: any[] = []
  if (companionIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('npcs')
      .select('id, name, type, speech_style, dialogue_intro')
      .in('id', companionIds)
    npcs = data ?? []
  }
  if (npcs.length === 0) {
    return NextResponse.json({ error: 'Aucun PNJ compagnon trouvé pour cette section' }, { status: 400 })
  }

  const sceneText = section.content?.trim() || section.summary?.trim() || ''

  // ── Étape 1 : Claude structure la scène de discussion ─────────────────────
  const structurePrompt = `Tu es l'architecte narratif d'un livre-jeu interactif.

LIVRE : "${book.title}" — ${book.theme}
PUBLIC : ${book.age_range} ans
PROTAGONISTE : ${book.protagonist_description || 'le héros'}
ADRESSE : ${book.address_form === 'tu' ? 'tutoiement' : 'vouvoiement'}

SECTION §${section.number} :
${sceneText.slice(0, 600)}

PNJ compagnons disponibles :
${npcs.map(n => `- ${n.name} (id: ${n.id}) — style : ${n.speech_style || 'non défini'}`).join('\n')}

Sections cibles disponibles (target_section_id) :
${(targetSections ?? []).map(s => `- id: "${s.id}" → §${s.number} — "${(s.summary ?? '').slice(0, 60)}"`).join('\n')}

OBJECTIF : Concevoir une scène de discussion en 2 temps.

TEMPS 1 — Le PNJ ouvre + le joueur répond (1er tour) :
- Le PNJ interpelle le joueur (npc_opening)
- 2 ou 3 choix de 1er tour : le joueur exprime son désir/position
- Pour chaque choix : le PNJ réagit (résistance ou accord)
  - Si le PNJ est d'accord → target_section_id (navigation directe)
  - Si le PNJ résiste → sub_choices (2e tour)

TEMPS 2 — 2e tour (seulement si le PNJ résiste) :
- Le joueur argumente davantage (sub_choices)
- Le PNJ finit TOUJOURS par se ranger derrière la décision du joueur
- Chaque sub_choice terminal a un target_section_id

RÈGLE : Chaque target_section_id DOIT être l'un des ids listés ci-dessus.

Réponds UNIQUEMENT en JSON valide :
{
  "npc_id": "id du PNJ",
  "npc_opening": "phrase d'ouverture du PNJ",
  "outcome_thought": "pensée du protagoniste à la fin (1 phrase courte)",
  "choices": [
    {
      "id": "c1",
      "player_text": "ce que dit le joueur (5-10 mots naturels)",
      "emotion_label": "Courageux|Prudent|Discret|Fuir|Convaincre|etc.",
      "npc_response": "réaction du PNJ",
      "target_section_id": "id si navigation directe (facultatif)",
      "sub_choices": [
        {
          "id": "sc1",
          "player_text": "le joueur argumente (5-10 mots)",
          "emotion_label": "Insister|Négocier|etc.",
          "npc_response": "le PNJ cède et suit le joueur",
          "target_section_id": "id obligatoire"
        }
      ]
    }
  ]
}`

  let structureRaw: string
  try {
    structureRaw = await generateText('claude', '', structurePrompt, 1500)
  } catch (err: any) {
    return NextResponse.json({ error: `Claude error: ${err.message}` }, { status: 500 })
  }

  let structure: { npc_id: string; npc_opening: string; outcome_thought?: string; choices: any[] }
  try {
    const jsonStr = extractJson(structureRaw)
    structure = JSON.parse(fixJsonControlChars(jsonStr))
  } catch {
    return NextResponse.json({ error: 'Impossible de parser la structure Claude', raw: structureRaw }, { status: 500 })
  }

  // Valider les ids
  const validNpcIds = new Set(npcs.map(n => n.id))
  const validSectionIds = new Set(targetSectionIds)
  if (!validNpcIds.has(structure.npc_id)) structure.npc_id = npcs[0].id

  const validateSectionId = (id: any) => validSectionIds.has(id) ? id : undefined

  structure.choices = (structure.choices ?? []).map((c: any) => ({
    ...c,
    target_section_id: validateSectionId(c.target_section_id),
    sub_choices: Array.isArray(c.sub_choices)
      ? c.sub_choices.map((sc: any) => ({
          ...sc,
          target_section_id: validateSectionId(sc.target_section_id) ?? [...validSectionIds][0],
        }))
      : undefined,
  })).filter((c: any) => c.target_section_id || c.sub_choices?.length)

  if (structure.choices.length === 0) {
    return NextResponse.json({ error: 'Aucun choix valide généré', raw: structureRaw }, { status: 500 })
  }

  // ── Étape 2 : Mistral rédige les textes dans le style du PNJ ──────────────
  const selectedNpc = npcs.find(n => n.id === structure.npc_id)!
  const textItems: string[] = []
  textItems.push(`OPENING: "${structure.npc_opening}"`)
  structure.choices.forEach((c: any, ci: number) => {
    textItems.push(`NPC_RESPONSE[${ci}]: "${c.npc_response}"`)
    if (c.sub_choices) {
      c.sub_choices.forEach((sc: any, sci: number) => {
        textItems.push(`NPC_CAPITULATION[${ci}][${sci}]: "${sc.npc_response}"`)
      })
    }
  })

  const mistralPrompt = `Tu es un auteur de livres-jeux. Réécris chaque réplique du PNJ dans son style de parole exact.

PNJ : ${selectedNpc.name}
Style de parole : ${selectedNpc.speech_style || 'naturel, direct'}
Thème : ${book.theme}
Scène : ${sceneText.slice(0, 200)}

RÈGLES : Garde le sens exact, adapte uniquement le style et le registre de langue du PNJ. 1-2 phrases max par réplique. Pour les "capitulation", le PNJ doit clairement se ranger derrière la décision du joueur tout en gardant son style. Ne jamais écrire en MAJUSCULES — l'intensité s'exprime par le choix des mots, pas par la casse.

Textes à réécrire (conserve les balises exactement) :
${textItems.join('\n')}

Réponds UNIQUEMENT avec un objet JSON {"OPENING":"...","NPC_RESPONSE":["...","..."],"NPC_CAPITULATION":[["..."],["...",...]]}`

  let mistralParsed: any = {}
  try {
    const mistralRaw = await callMistral(
      'Tu es un auteur de livres-jeux. Réécris les répliques dans le style du PNJ. Réponds uniquement en JSON.',
      mistralPrompt,
      1500
    )
    const jsonStr = extractJson(mistralRaw)
    mistralParsed = JSON.parse(fixJsonControlChars(jsonStr))
  } catch {
    // Fallback : garder les textes de Claude
  }

  const getStr = (val: any) => (typeof val === 'string' && val.trim() ? val.trim() : null)

  // Assembler la scène finale
  const finalChoices = structure.choices.map((c: any, ci: number) => {
    const npcResp = getStr(mistralParsed?.NPC_RESPONSE?.[ci]) ?? c.npc_response
    const subChoices = c.sub_choices?.map((sc: any, sci: number) => ({
      id: sc.id ?? `sc${ci}_${sci}`,
      player_text: sc.player_text,
      emotion_label: sc.emotion_label,
      npc_response: getStr(mistralParsed?.NPC_CAPITULATION?.[ci]?.[sci]) ?? sc.npc_response,
      ...(sc.target_section_id ? { target_section_id: sc.target_section_id } : {}),
    }))

    return {
      id: c.id ?? `c${ci}`,
      player_text: c.player_text,
      emotion_label: c.emotion_label,
      npc_response: npcResp,
      ...(c.target_section_id ? { target_section_id: c.target_section_id } : {}),
      ...(subChoices?.length ? { sub_choices: subChoices } : {}),
    }
  })

  const discussion_scene = {
    npc_id: structure.npc_id,
    npc_opening: getStr(mistralParsed?.OPENING) ?? structure.npc_opening,
    outcome_thought: getStr(structure.outcome_thought) ?? undefined,
    choices: finalChoices,
  }

  // ── Sauvegarder dans les tables relationnelles + cache JSONB ───────────────
  const { data: scene, error: sceneErr } = await supabaseAdmin
    .from('discussion_scenes')
    .upsert({ section_id: id, ...discussion_scene, choices: undefined }, { onConflict: 'section_id' })
    .select('id').single()

  if (sceneErr || !scene) return NextResponse.json({ error: sceneErr?.message }, { status: 500 })

  await supabaseAdmin.from('discussion_choices').delete().eq('scene_id', scene.id)
  await insertChoicesRecursive(finalChoices, scene.id, null)

  // Cache JSONB pour le simulateur
  await supabaseAdmin.from('sections')
    .update({ discussion_scene: { scene_id: scene.id, ...discussion_scene } })
    .eq('id', id)

  return NextResponse.json({ ok: true, discussion_scene: { scene_id: scene.id, ...discussion_scene } })
}
