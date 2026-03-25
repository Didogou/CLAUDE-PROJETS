import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropic, generateText, extractJson, normalizeEndingType, normalizeNpcType } from '@/lib/ai-utils'
import { buildActSplitPrompt, buildNpcLocationPrompt, buildItemsPrompt, buildSectionBatchPrompt } from '@/lib/prompts'
import type { BookAct } from '@/types'

export const maxDuration = 600

const BATCH_SIZE = 30
const VALID_TRIAL_TYPES = new Set(['combat', 'agilite', 'intelligence', 'magie', 'chance', 'crochetage', 'dialogue', 'enigme'])

// ── Auto-réparation après génération ────────────────────────────────────────

async function runAutoRepair(
  bookId: string,
  npcNameMap: Map<string, any>,
  totalSections: number
): Promise<{ fixed: number; remaining_critical: number; log: string[] }> {
  const log: string[] = []
  let fixed = 0

  // Charger l'état courant
  const { data: sections } = await supabaseAdmin
    .from('sections').select('id, number, summary, is_ending, ending_type, trial')
    .eq('book_id', bookId).order('number')
  if (!sections?.length) return { fixed, remaining_critical: 0, log }

  const sectionIds = sections.map((s: any) => s.id)
  const { data: choices } = await supabaseAdmin
    .from('choices').select('id, section_id, target_section_id, label')
    .in('section_id', sectionIds)

  const choicesArr = choices ?? []
  const sectionByNumber = new Map(sections.map((s: any) => [s.number, s]))
  const sectionById = new Map(sections.map((s: any) => [s.id, s]))

  // ── Fix 1 : ending_type null ─────────────────────────────────────────────
  const endingNoType = sections.filter((s: any) => s.is_ending && !s.ending_type)
  for (const sec of endingNoType) {
    await supabaseAdmin.from('sections').update({ ending_type: 'death' }).eq('id', sec.id)
    fixed++
  }
  if (endingNoType.length) log.push(`✓ ${endingNoType.length} fin(s) sans type → "mort"`)

  // ── Fix 2 : type d'épreuve invalide ──────────────────────────────────────
  const invalidTrials = sections.filter((s: any) => {
    const t = s.trial as any
    return t?.type && !VALID_TRIAL_TYPES.has(t.type)
  })
  for (const sec of invalidTrials) {
    const t = sec.trial as any
    const corrected = t.type === 'intel' ? 'intelligence' : t.type.startsWith('enigm') ? 'enigme' : 'intelligence'
    await supabaseAdmin.from('sections').update({ trial: { ...t, type: corrected } }).eq('id', sec.id)
    fixed++
  }
  if (invalidTrials.length) log.push(`✓ ${invalidTrials.length} type(s) d'épreuve invalide(s) corrigé(s)`)

  // ── Fix 3 : boucles infinies ──────────────────────────────────────────────
  const loops = choicesArr.filter((c: any) => c.section_id === c.target_section_id)
  if (loops.length > 0) {
    const loopContexts = loops.map((c: any) => {
      const sec = sectionById.get(c.section_id) as any
      const num = sec?.number ?? 0
      const neighbors = sections
        .filter((s: any) => s.number >= num - 1 && s.number <= num + 5 && s.number !== num)
        .map((s: any) => `§${s.number}: ${s.summary ?? ''}`)
        .join('\n')
      return `Boucle §${num} — choix: "${c.label}"\nVoisines:\n${neighbors}`
    }).join('\n\n---\n\n')

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: `Livre de ${totalSections} sections. Ces choix pointent sur leur propre section. Pour chacun, indique la section cible la plus cohérente narrativement.\n\n${loopContexts}\n\nJSON brut : [{"choice_id":"...","target":91},...]` }],
      })
      const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const assignments: any[] = JSON.parse(extractJson(raw))
      for (const a of assignments) {
        const target = sectionByNumber.get(a.target) as any
        if (!target) continue
        await supabaseAdmin.from('choices').update({ target_section_id: target.id }).eq('id', a.choice_id)
        fixed++
      }
      log.push(`✓ ${loops.length} boucle(s) infinie(s) redirigée(s)`)
    } catch {
      log.push(`⚠ Boucles non corrigées (Claude indisponible)`)
    }
  }

  // ── Fix 4 : combats sans ennemi ───────────────────────────────────────────
  const combatNoEnemy = sections.filter((s: any) => {
    const t = s.trial as any
    return t?.type === 'combat' && !t?.npc_id && !t?.enemy
  })
  if (combatNoEnemy.length > 0) {
    const { data: npcs } = await supabaseAdmin
      .from('npcs').select('id, name, type, description, force, endurance')
      .eq('book_id', bookId).in('type', ['ennemi', 'boss'])

    if (npcs?.length) {
      const npcList = npcs.map((n: any) => `"${n.name}" (${n.type}): ${n.description ?? ''}`).join('\n')
      const secList = combatNoEnemy.map((s: any) => `§${s.number}: ${s.summary ?? ''}`).join('\n')
      try {
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: `PNJ disponibles :\n${npcList}\n\nSections combat sans ennemi :\n${secList}\n\nAssigne le PNJ le plus adapté à chaque section.\nJSON brut : [{"number":7,"npc_name":"..."},...]` }],
        })
        const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
        const assignments: any[] = JSON.parse(extractJson(raw))
        const npcByName = new Map(npcs.map((n: any) => [n.name.toLowerCase(), n]))
        for (const a of assignments) {
          const sec = sections.find((s: any) => s.number === a.number) as any
          const npc = npcByName.get(a.npc_name?.toLowerCase())
          if (!sec || !npc) continue
          const updatedTrial = { ...(sec.trial as object), npc_id: npc.id, enemy: { name: npc.name, force: npc.force, endurance: npc.endurance } }
          await supabaseAdmin.from('sections').update({ trial: updatedTrial }).eq('id', sec.id)
          fixed++
        }
        log.push(`✓ ${combatNoEnemy.length} combat(s) sans ennemi — PNJ assignés`)
      } catch {
        log.push(`⚠ Combats sans ennemi non corrigés (Claude indisponible)`)
      }
    }
  }

  // ── Fix 5 : routage d'épreuve incomplet (success ou failure manquant) ─────
  const outgoing = new Map<string, string[]>()
  for (const c of choicesArr) {
    if (!outgoing.has(c.section_id)) outgoing.set(c.section_id, [])
    if (c.target_section_id) outgoing.get(c.section_id)!.push(c.target_section_id)
  }

  const trialNoRouting = sections.filter((s: any) => {
    if (s.is_ending) return false
    const t = s.trial as any
    return t && (!t.success_section_id || !t.failure_section_id)
  })

  if (trialNoRouting.length > 0) {
    const secList = trialNoRouting.map((s: any) => {
      const t = s.trial as any
      const missing = []
      if (!t.success_section_id) missing.push('succès')
      if (!t.failure_section_id) missing.push('échec')
      const neighbors = sections
        .filter((n: any) => n.number > s.number && n.number <= s.number + 8)
        .map((n: any) => `§${n.number}: ${n.summary ?? ''}`)
        .join(' | ')
      return `§${s.number} [${t.type}] manque: ${missing.join('+')} — suite disponible: ${neighbors}`
    }).join('\n')

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: `Livre ${totalSections} sections. Épreuves avec routage incomplet — indique les sections de succès et/ou d'échec les plus cohérentes.\n\n${secList}\n\nJSON brut : [{"section_number":21,"success":22,"failure":19},...]` }],
      })
      const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const fixes: any[] = JSON.parse(extractJson(raw))
      for (const fix of fixes) {
        const sec = sections.find((s: any) => s.number === fix.section_number) as any
        if (!sec) continue
        const t = sec.trial as any
        const updates: any = { ...t }
        if (!t.success_section_id && fix.success) {
          const target = sectionByNumber.get(fix.success) as any
          if (target) updates.success_section_id = target.id
        }
        if (!t.failure_section_id && fix.failure) {
          const target = sectionByNumber.get(fix.failure) as any
          if (target) updates.failure_section_id = target.id
        }
        await supabaseAdmin.from('sections').update({ trial: updates }).eq('id', sec.id)
        fixed++
      }
      log.push(`✓ ${trialNoRouting.length} épreuve(s) avec routage incomplet corrigée(s)`)
    } catch {
      log.push(`⚠ Routage d'épreuves non corrigé (Claude indisponible)`)
    }
  }

  // ── Fix 6 : culs-de-sac (sans choix et sans épreuve) ─────────────────────
  const deadEnds = sections.filter((s: any) => {
    if (s.is_ending) return false
    const hasChoices = (outgoing.get(s.id) ?? []).length > 0
    const t = s.trial as any
    const hasTrialRouting = t && (t.success_section_id || t.failure_section_id)
    return !hasChoices && !hasTrialRouting && !t
  })

  if (deadEnds.length > 0) {
    const secList = deadEnds.map((s: any) => {
      const neighbors = sections
        .filter((n: any) => n.number > s.number && n.number <= s.number + 6)
        .map((n: any) => `§${n.number}: ${n.summary ?? ''}`)
        .join(' | ')
      return `§${s.number}: "${s.summary ?? ''}" — sections suivantes disponibles: ${neighbors}`
    }).join('\n')

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1536,
        messages: [{ role: 'user', content: `Livre ${totalSections} sections. Ces sections n'ont aucun choix. Génère 2 choix cohérents pour chacune (libellé immersif + numéro de section cible).\n\n${secList}\n\nJSON brut : [{"section_number":12,"choices":[{"label":"...","target":13},{"label":"...","target":16}]},...]` }],
      })
      const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const fixes: any[] = JSON.parse(extractJson(raw))
      for (const fix of fixes) {
        const sec = sections.find((s: any) => s.number === fix.section_number) as any
        if (!sec || !fix.choices?.length) continue
        const toInsert = fix.choices
          .filter((c: any) => sectionByNumber.has(c.target))
          .map((c: any, i: number) => ({
            section_id: sec.id,
            label: c.label,
            target_section_id: (sectionByNumber.get(c.target) as any).id,
            requires_trial: false,
            sort_order: i,
            is_back: false,
          }))
        if (toInsert.length) {
          await supabaseAdmin.from('choices').insert(toInsert)
          fixed++
        }
      }
      log.push(`✓ ${deadEnds.length} cul(s)-de-sac résolus avec de nouveaux choix`)
    } catch {
      log.push(`⚠ Culs-de-sac non corrigés (Claude indisponible)`)
    }
  }

  // ── Compter les problèmes critiques restants ──────────────────────────────
  const { data: finalSections } = await supabaseAdmin
    .from('sections').select('id, number, is_ending, ending_type, trial')
    .eq('book_id', bookId)
  const { data: finalChoices } = await supabaseAdmin
    .from('choices').select('section_id, target_section_id')
    .in('section_id', (finalSections ?? []).map((s: any) => s.id))

  let remaining = 0
  const finalOut = new Map<string, boolean>()
  for (const c of finalChoices ?? []) finalOut.set(c.section_id, true)
  for (const s of finalSections ?? []) {
    if (s.is_ending) continue
    const t = s.trial as any
    const hasCritical =
      (!finalOut.has(s.id) && !t?.success_section_id && !t?.failure_section_id) ||
      (finalChoices ?? []).some((c: any) => c.section_id === s.id && c.target_section_id === s.id)
    if (hasCritical) remaining++
  }

  return { fixed, remaining_critical: remaining, log }
}

// ── Route principale ─────────────────────────────────────────────────────────

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const { data: book, error } = await supabaseAdmin.from('books').select('*').eq('id', id).single()
    if (error || !book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })
    if (book.phase && book.phase !== 'draft') {
      return NextResponse.json({ error: 'La structure a déjà été générée' }, { status: 409 })
    }

    const totalSections = book.num_sections ?? 30

    let seriesBible: string | null = null
    if (book.project_id) {
      const { data: project } = await supabaseAdmin
        .from('projects').select('series_bible').eq('id', book.project_id).single()
      seriesBible = project?.series_bible ?? null
    }

    const bookParams = {
      title:        book.title,
      theme:        book.theme,
      synopsis:     book.synopsis ?? undefined,
      book_summary: book.synopsis?.trim() || book.book_summary,
      age_range:    book.age_range,
      context_type: book.context_type,
      language:     book.language,
      difficulty:   book.difficulty,
      num_sections: totalSections,
      content_mix:  book.content_mix ?? { combat: 20, chance: 10, enigme: 10, magie: 5 },
      map_style:    book.map_style ?? null,
      address_form: book.address_form,
      description:  book.description,
    }

    const system = 'Tu es un générateur de JSON. Ta réponse entière doit être du JSON brut valide. Aucun texte avant ou après.'

    // ── ÉTAPE 0 : Découpe en 3 actes ──────────────────────────────────────────
    let acts: BookAct[] | null = null
    const narrativeSource = book.synopsis?.trim() || book.book_summary?.trim()

    if (narrativeSource) {
      try {
        const actsRaw = await generateText(
          'opus', system,
          buildActSplitPrompt(book.title, book.theme, narrativeSource, totalSections),
          2048
        )
        const parsed = JSON.parse(extractJson(actsRaw))
        if (Array.isArray(parsed) && parsed.length === 3) {
          acts = parsed as BookAct[]
          await supabaseAdmin.from('books').update({ acts }).eq('id', id)
        }
      } catch {
        // non bloquant
      }
    }

    // ── ÉTAPE 1 : PNJ + Lieux ─────────────────────────────────────────────────
    const npcRaw = await generateText('opus', system, buildNpcLocationPrompt(bookParams, seriesBible), 8192)

    let npcStructure: { npcs?: any[]; locations?: any[] }
    try {
      npcStructure = JSON.parse(extractJson(npcRaw))
    } catch {
      throw new Error(`JSON PNJ invalide : ${npcRaw.slice(0, 400)}`)
    }

    const locationNameMap = new Map<string, string>()
    const locationNames: string[] = []
    if (npcStructure.locations?.length && book.map_style) {
      const { data: insertedLocs } = await supabaseAdmin
        .from('locations')
        .insert(npcStructure.locations.map((l: any) => ({
          book_id: id, name: l.name,
          x: Math.min(100, Math.max(0, l.x ?? 50)),
          y: Math.min(100, Math.max(0, l.y ?? 50)),
          icon: l.icon ?? '📍',
        }))).select()
      for (const loc of insertedLocs ?? []) {
        locationNameMap.set(loc.name.toLowerCase(), loc.id)
        locationNames.push(loc.name)
      }
    }

    const npcNameMap = new Map<string, any>()
    const npcNames: string[] = []
    if (npcStructure.npcs?.length) {
      const { data: insertedNpcs } = await supabaseAdmin
        .from('npcs')
        .insert(npcStructure.npcs.map((n: any) => ({
          book_id: id,
          name: n.name, type: normalizeNpcType(n.type),
          description: n.description ?? null,
          appearance: n.appearance ?? null,
          origin: n.origin ?? null,
          force: n.force ?? 5, agilite: n.agilite ?? 5,
          intelligence: n.intelligence ?? 5, magie: n.magie ?? 0, endurance: n.endurance ?? 10,
          chance: n.chance ?? 5, special_ability: n.special_ability ?? null,
          resistances: n.resistances ?? null, loot: n.loot ?? null,
          speech_style: n.speech_style ?? null, dialogue_intro: n.dialogue_intro ?? null,
        }))).select()
      for (const npc of insertedNpcs ?? []) {
        npcNameMap.set(npc.name.toLowerCase(), { id: npc.id, force: npc.force, agilite: npc.agilite, endurance: npc.endurance })
        npcNames.push(npc.name)
      }
    }

    // ── ÉTAPE 1b : Objets depuis le synopsis ──────────────────────────────────
    let items_count = 0
    const synopsisForItems = book.synopsis?.trim() || book.book_summary?.trim()
    if (synopsisForItems) {
      try {
        const itemsRaw = await generateText('opus', system, buildItemsPrompt(book.title, book.theme, synopsisForItems), 2048)
        const itemsArr: any[] = JSON.parse(extractJson(itemsRaw))
        const VALID_ITEM_TYPES = new Set(['soin', 'mana', 'arme', 'armure', 'outil', 'quete', 'grimoire'])
        if (Array.isArray(itemsArr) && itemsArr.length > 0) {
          const itemsToInsert = itemsArr
            .filter((it: any) => it.name && VALID_ITEM_TYPES.has(it.item_type))
            .map((it: any) => ({
              book_id: id,
              name: it.name,
              item_type: it.item_type,
              description: it.description ?? null,
              effect: it.effect ?? {},
              sections_used: [],
            }))
          if (itemsToInsert.length > 0) {
            const { error: itemsError } = await supabaseAdmin.from('items').insert(itemsToInsert)
            if (itemsError) {
              console.error('[generate-sections] items insert error:', itemsError)
            } else {
              items_count = itemsToInsert.length
            }
          }
        }
      } catch (itemsErr: any) {
        console.error('[generate-sections] items step error:', itemsErr?.message)
      }
    }

    // ── ÉTAPE 2 : Sections par lots avec actes ────────────────────────────────
    const allRawSections: any[] = []
    let previousSummaries: string[] = []

    for (let from = 1; from <= totalSections; from += BATCH_SIZE) {
      const to = Math.min(from + BATCH_SIZE - 1, totalSections)
      const isLastBatch = to === totalSections

      const currentAct = acts?.find(a => from >= a.from_section && from <= a.to_section)
      const actInfo = currentAct ? {
        title:     currentAct.title,
        synopsis:  currentAct.synopsis,
        actNumber: acts!.indexOf(currentAct) + 1,
      } : undefined

      const batchRaw = await generateText(
        'opus', system,
        buildSectionBatchPrompt(bookParams, npcNames, locationNames, from, to, totalSections, isLastBatch, previousSummaries, actInfo, undefined, seriesBible),
        8192
      )

      let batchStructure: { sections: any[] }
      try {
        batchStructure = JSON.parse(extractJson(batchRaw))
      } catch {
        throw new Error(`JSON sections invalide (lot ${from}-${to}) : ${batchRaw.slice(0, 400)}`)
      }

      if (!Array.isArray(batchStructure.sections)) {
        throw new Error(`Lot ${from}-${to} : pas de tableau "sections"`)
      }

      allRawSections.push(...batchStructure.sections)
      previousSummaries = batchStructure.sections
        .slice(-3)
        .map((s: any) => `§${s.number} : "${s.summary ?? ''}"`)
    }

    // ── Calcul du tension_level ────────────────────────────────────────────────
    function calcTension(s: any, total: number): number {
      let t = 3 // base
      // Position dans le livre (fin = plus tendu)
      const progress = s.number / total
      t += Math.round(progress * 3)
      // Type de scène
      const arc = (s.narrative_arc?.type ?? s.narrative_arc ?? '').toLowerCase()
      if (['combat', 'boss', 'confrontation', 'climax'].some((k: string) => arc.includes(k))) t += 3
      else if (['enigme', 'danger', 'fuite', 'piège'].some((k: string) => arc.includes(k))) t += 2
      else if (['exploration', 'dialogue', 'repos'].some((k: string) => arc.includes(k))) t -= 1
      // Épreuve présente
      if (s.trial) t += 2
      // Section de fin
      if (s.is_ending) t += 2
      return Math.min(10, Math.max(0, t))
    }

    // ── Insertion des sections ─────────────────────────────────────────────────
    const sectionsToInsert = allRawSections.map((s: any) => ({
      book_id:       id,
      number:        s.number,
      summary:       s.summary ?? null,
      hint_text:     s.hint ?? null,
      content:       '',
      is_ending:     s.is_ending ?? false,
      ending_type:   normalizeEndingType(s.ending_type),
      trial:         null,
      narrative_arc: s.narrative_arc ?? null,
      location_id:   s.location_name ? (locationNameMap.get(s.location_name.toLowerCase()) ?? null) : null,
      tension_level: calcTension(s, totalSections),
      status:        'draft',
    }))

    const { data: insertedSections, error: sectionsError } = await supabaseAdmin
      .from('sections').insert(sectionsToInsert).select()
    if (sectionsError) throw sectionsError

    const sectionMap = new Map<number, string>(insertedSections.map((s: any) => [s.number, s.id]))

    // ── Insertion des choix ────────────────────────────────────────────────────
    const choicesToInsert: any[] = []
    for (const s of allRawSections) {
      const sectionId = sectionMap.get(s.number)
      if (!sectionId || !s.choices?.length) continue
      for (const c of s.choices) {
        choicesToInsert.push({
          section_id:        sectionId,
          label:             c.label,
          target_section_id: sectionMap.get(c.target_section) ?? null,
          requires_trial:    false,
          sort_order:        c.sort_order ?? 0,
          is_back:           c.is_back ?? false,
        })
      }
    }
    if (choicesToInsert.length > 0) await supabaseAdmin.from('choices').insert(choicesToInsert)

    // ── Résolution des trials ──────────────────────────────────────────────────
    for (const s of allRawSections) {
      if (!s.trial) continue
      const sectionId = sectionMap.get(s.number)
      if (!sectionId) continue
      const rawTrial = s.trial
      const npcData = rawTrial.enemy_name ? npcNameMap.get(rawTrial.enemy_name.toLowerCase()) : null
      const trial: Record<string, any> = {
        type: rawTrial.type, stat: rawTrial.stat,
        success_section_id: sectionMap.get(rawTrial.success_section) ?? null,
        failure_section_id: sectionMap.get(rawTrial.failure_section) ?? null,
        endurance_loss_on_failure: rawTrial.endurance_loss_on_failure ?? null,
        mana_cost: rawTrial.mana_cost ?? null, xp_reward: rawTrial.xp_reward ?? null,
        item_rewards: rawTrial.item_rewards ?? null,
        dialogue_opening: rawTrial.dialogue_opening ?? null,
        dialogue_goal: rawTrial.dialogue_goal ?? null,
      }
      if (npcData) {
        trial.npc_id = npcData.id
        trial.enemy = { name: rawTrial.enemy_name, force: npcData.force, endurance: npcData.endurance }
      }
      await supabaseAdmin.from('sections').update({ trial }).eq('id', sectionId)
    }

    await supabaseAdmin.from('books').update({ phase: 'structure_generated' }).eq('id', id)

    // ── ÉTAPE 3 : Assignation automatique des compagnons ──────────────────────
    let companions_assigned = 0
    try {
      const companionNpcs = (npcStructure.npcs ?? [])
        .map((n: any) => ({ name: n.name, type: n.type }))
        .filter((n: any) => n.type === 'allié' || n.type === 'neutre')

      if (companionNpcs.length > 0) {
        const synopsis = book.synopsis?.trim() || book.book_summary?.trim() || book.theme

        const sectionLines = allRawSections
          .map((s: any) => `§${s.number}: ${s.summary ?? '(sans résumé)'}`)
          .join('\n')

        const companionLines = companionNpcs
          .map((n: any) => `- ${n.name} (${n.type})`)
          .join('\n')

        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: `Tu es l'auteur d'un livre "Dont Vous Êtes le Héros" : "${book.title}"\n\nSynopsis :\n${synopsis}\n\nCompagnons potentiels (alliés/neutres qui accompagnent le héros) :\n${companionLines}\n\nRègle : un compagnon EST présent dans une section à moins que son résumé indique clairement qu'il est absent, seul, parti, ou que la scène est solo. Par défaut inclure tous les compagnons.\n\nSections :\n${sectionLines}\n\nPour chaque section, liste les noms des compagnons présents.\nJSON brut uniquement : [{"number":1,"companions":["Nom1","Nom2"]},...]`,
          }],
        })

        const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
        const assignments: { number: number; companions: string[] }[] = JSON.parse(extractJson(raw))

        // Construire map name → npc_id depuis les NPCs insérés
        const { data: insertedCompanions } = await supabaseAdmin
          .from('npcs').select('id, name, type')
          .eq('book_id', id).in('type', ['allié', 'neutre'])
        const companionIdByName = new Map(
          (insertedCompanions ?? []).map((n: any) => [n.name.toLowerCase(), n.id])
        )

        for (const a of assignments) {
          const sectionId = sectionMap.get(a.number)
          if (!sectionId || !a.companions?.length) continue
          const ids = a.companions
            .map((name: string) => companionIdByName.get(name.toLowerCase()))
            .filter(Boolean) as string[]
          if (!ids.length) continue
          await supabaseAdmin.from('sections').update({ companion_npc_ids: ids }).eq('id', sectionId)
          companions_assigned += ids.length
        }
      }
    } catch {
      // non bloquant
    }

    // ── ÉTAPE 4 : Passe de validation et réparation automatique ───────────────
    let validation: { fixed: number; remaining_critical: number; log: string[] } = { fixed: 0, remaining_critical: 0, log: [] }
    try {
      validation = await runAutoRepair(id, npcNameMap, totalSections)
    } catch (valErr: any) {
      validation.log.push(`⚠ Validation échouée : ${valErr.message}`)
    }

    // ── ÉTAPE 5 : Génération des textes de retour de section ──────────────────
    let transitions_generated = 0
    try {
      const summaryById = new Map<string, string>(
        insertedSections.map((s: any) => [s.id, s.summary ?? ''])
      )
      // Recharger les choix après réparation (de nouvelles cibles ont pu être assignées)
      const { data: allChoices } = await supabaseAdmin
        .from('choices')
        .select('id, section_id, target_section_id, label')
        .in('section_id', insertedSections.map((s: any) => s.id))

      const validChoices = (allChoices ?? []).filter(
        (c: any) => c.target_section_id && summaryById.get(c.section_id) && summaryById.get(c.target_section_id)
      )

      const styleNote = book.age_range === '8-12'
        ? 'Écris pour un jeune public (8-12 ans) : phrases simples, vocabulaire accessible, ton dynamique.'
        : book.age_range === '13-17'
        ? 'Écris pour des adolescents : style rythmé, immersif, tension narrative.'
        : 'Style Pierre Bordage : 2e personne du singulier, phrases courtes, très immersif.'

      const TRANSITION_BATCH = 5
      for (let i = 0; i < validChoices.length; i += TRANSITION_BATCH) {
        const batch = validChoices.slice(i, i + TRANSITION_BATCH)
        await Promise.all(batch.map(async (choice: any) => {
          const sourceSummary = summaryById.get(choice.section_id) ?? ''
          const targetSummary = summaryById.get(choice.target_section_id) ?? ''
          try {
            const [msgTransition, msgReturn] = await Promise.all([
              anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 200,
                messages: [{ role: 'user', content: `Livre LDVELH "${book.title}" (${book.theme}). Écris un court texte de TRANSITION (2-3 phrases, 30-50 mots max) quand le lecteur choisit : "${choice.label}".\nSection de départ : ${sourceSummary}\nSection d'arrivée : ${targetSummary}\n${styleNote}\nRéponds uniquement avec le texte, sans guillemets ni balises.` }],
              }),
              anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 200,
                messages: [{ role: 'user', content: `Livre LDVELH "${book.title}" (${book.theme}). Écris un court TEXTE DE RETOUR (2-3 phrases, 30-50 mots max) affiché quand le joueur revient à la section de départ après avoir visité la section d'arrivée. Ton mémoriel : "Tu te souviens…", "De retour ici…".\nSection de départ : ${sourceSummary}\nSection d'arrivée : ${targetSummary}\n${styleNote}\nRéponds uniquement avec le texte, sans guillemets ni balises.` }],
              }),
            ])
            const transition_text = msgTransition.content[0].type === 'text' ? msgTransition.content[0].text.trim() : ''
            const return_text = msgReturn.content[0].type === 'text' ? msgReturn.content[0].text.trim() : ''
            const update: any = {}
            if (transition_text) update.transition_text = transition_text
            if (return_text) update.return_text = return_text
            if (Object.keys(update).length) {
              await supabaseAdmin.from('choices').update(update).eq('id', choice.id)
              transitions_generated++
            }
          } catch {
            // non bloquant
          }
        }))
      }
    } catch {
      // non bloquant
    }

    return NextResponse.json({
      sections_count:      insertedSections.length,
      npcs_count:          npcStructure.npcs?.length ?? 0,
      items_count,
      choices_count:       choicesToInsert.length,
      acts_count:          acts?.length ?? 0,
      companions_assigned,
      transitions_generated,
      validation,
    })
  } catch (err: any) {
    console.error('[generate-sections]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
