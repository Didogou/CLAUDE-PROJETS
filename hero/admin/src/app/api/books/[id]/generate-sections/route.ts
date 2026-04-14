import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropic, generateText, extractJson, normalizeEndingType, normalizeNpcType } from '@/lib/ai-utils'
import { buildActSplitPrompt, buildJunctionMapPrompt, buildNpcLocationPrompt, buildItemsPrompt, buildSectionBatchPrompt, buildSkeletonPrompt, buildEnrichmentPrompt } from '@/lib/prompts'
import type { BookAct, ParallelBookStructure, JunctionSection, NarrativePath, PathSegment } from '@/types'

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
      let loopsFixed = 0
      for (const a of assignments) {
        const target = sectionByNumber.get(a.target) as any
        if (!target) { log.push(`⚠ Boucle §${a.choice_id} : section cible §${a.target} introuvable — non résolue`); continue }
        await supabaseAdmin.from('choices').update({ target_section_id: target.id }).eq('id', a.choice_id)
        fixed++; loopsFixed++
      }
      log.push(`✓ ${loopsFixed}/${loops.length} boucle(s) infinie(s) redirigée(s)`)
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
        let combatFixed = 0
        for (const a of assignments) {
          const sec = sections.find((s: any) => s.number === a.number) as any
          const npc = npcByName.get(a.npc_name?.toLowerCase())
          if (!sec) continue
          if (!npc) { log.push(`⚠ §${a.number} combat : PNJ "${a.npc_name}" introuvable dans la liste`); continue }
          const updatedTrial = { ...(sec.trial as object), npc_id: npc.id, enemy: { name: npc.name, force: npc.force, endurance: npc.endurance } }
          await supabaseAdmin.from('sections').update({ trial: updatedTrial }).eq('id', sec.id)
          fixed++; combatFixed++
        }
        log.push(`✓ ${combatFixed}/${combatNoEnemy.length} combat(s) sans ennemi — PNJ assignés`)
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

  // ── Fix 7 : sections orphelines — 2 passes max pour éviter les boucles ─────
  {
    const MAX_ORPHAN_PASSES = 2
    let passOrphansFixed = 0

    for (let pass = 1; pass <= MAX_ORPHAN_PASSES; pass++) {
      // Recharger l'état courant à chaque passe (les passes précédentes ont pu modifier la BDD)
      const { data: orphanSections } = await supabaseAdmin
        .from('sections').select('id, number, summary, is_ending, trial')
        .eq('book_id', bookId).order('number')
      const orphanIds = (orphanSections ?? []).map((s: any) => s.id)
      const { data: orphanChoices } = await supabaseAdmin
        .from('choices').select('section_id, target_section_id')
        .in('section_id', orphanIds)

      // Map des sorties (choices + trial routing)
      const orphanOut = new Map<string, string[]>()
      for (const c of orphanChoices ?? []) {
        if (!c.target_section_id) continue
        if (!orphanOut.has(c.section_id)) orphanOut.set(c.section_id, [])
        orphanOut.get(c.section_id)!.push(c.target_section_id)
      }

      // BFS depuis §1
      const secMapO  = new Map((orphanSections ?? []).map((s: any) => [s.id, s]))
      const numToIdO = new Map((orphanSections ?? []).map((s: any) => [s.number, s.id]))
      const startIdO = numToIdO.get(1)
      const reachableO = new Set<string>()
      if (startIdO) {
        const q = [startIdO]; reachableO.add(startIdO)
        while (q.length > 0) {
          const cur = q.shift()!
          const s = secMapO.get(cur) as any
          if (!s || s.is_ending) continue
          const t = s.trial as any
          for (const nid of [t?.success_section_id, t?.failure_section_id].filter(Boolean)) {
            if (!reachableO.has(nid)) { reachableO.add(nid); q.push(nid) }
          }
          for (const nid of orphanOut.get(cur) ?? []) {
            if (!reachableO.has(nid)) { reachableO.add(nid); q.push(nid) }
          }
        }
      }

      const orphans = (orphanSections ?? []).filter((s: any) =>
        !s.is_ending && s.number !== 1 && !reachableO.has(s.id)
      )

      if (orphans.length === 0) {
        if (pass > 1) log.push(`✓ Passe ${pass} : aucune nouvelle orpheline — correction terminée`)
        break
      }

      const reachableDescs = (orphanSections ?? [])
        .filter((s: any) => reachableO.has(s.id) && !s.is_ending)
        .slice(0, 30)
        .map((s: any) => `§${s.number}: "${s.summary ?? ''}"`)
        .join('\n')
      const orphanDescs = orphans
        .map((s: any) => `§${s.number}: "${s.summary ?? ''}"`)
        .join('\n')

      try {
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: `Livre de ${totalSections} sections. Ces sections sont orphelines (aucun chemin depuis §1 ne les atteint) :\n${orphanDescs}\n\nSections accessibles (candidates pour pointer vers les orphelines) :\n${reachableDescs}\n\nPour chaque orpheline, indique la section accessible qui devrait avoir un choix menant vers elle, et un libellé immersif (3-5 mots).\nJSON brut : [{"orphan_number": N, "predecessor_number": M, "label": "..."}]` }],
        })
        const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
        const assignments: any[] = JSON.parse(extractJson(raw))
        let passFixed = 0
        for (const a of assignments) {
          const pred = (orphanSections ?? []).find((s: any) => s.number === a.predecessor_number) as any
          const orph = (orphanSections ?? []).find((s: any) => s.number === a.orphan_number) as any
          if (!pred || !orph) continue
          const { data: existingOut } = await supabaseAdmin
            .from('choices').select('sort_order').eq('section_id', pred.id)
            .order('sort_order', { ascending: false }).limit(1)
          const nextOrder = ((existingOut?.[0]?.sort_order ?? -1) + 1)
          const { error } = await supabaseAdmin.from('choices').insert({
            section_id: pred.id, target_section_id: orph.id,
            label: a.label || 'Continuer', requires_trial: false,
            sort_order: nextOrder, is_back: false,
          })
          if (!error) { fixed++; passFixed++; passOrphansFixed++ }
        }
        const remaining = orphans.length - passFixed
        log.push(`✓ Passe ${pass}/${MAX_ORPHAN_PASSES} orphelines : ${passFixed}/${orphans.length} connectée(s)${remaining > 0 && pass === MAX_ORPHAN_PASSES ? ` — ${remaining} résiduelle(s) à corriger manuellement` : ''}`)
      } catch {
        log.push(`⚠ Passe ${pass} orphelines : Claude indisponible`)
        break
      }
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
  const choiceNoTarget = new Set<string>(
    (finalChoices ?? []).filter((c: any) => !c.target_section_id).map((c: any) => c.section_id)
  )
  for (const s of finalSections ?? []) {
    if (s.is_ending) continue
    const t = s.trial as any
    const hasCritical =
      (!finalOut.has(s.id) && !t?.success_section_id && !t?.failure_section_id) ||  // cul-de-sac
      (finalChoices ?? []).some((c: any) => c.section_id === s.id && c.target_section_id === s.id) || // self-loop
      choiceNoTarget.has(s.id) ||                                                   // choix sans cible
      (t?.type === 'combat' && !t?.npc_id && !t?.enemy) ||                          // combat sans ennemi
      (t && (!t.success_section_id || !t.failure_section_id))                       // épreuve incomplète
    if (hasCritical) remaining++
  }

  return { fixed, remaining_critical: remaining, log }
}

// ── Calcul du tension_level ──────────────────────────────────────────────────
function calcTension(s: any, total: number): number {
  let t = 3
  const progress = s.number / total
  t += Math.round(progress * 3)
  const arc = (s.narrative_arc?.type ?? s.narrative_arc ?? '').toLowerCase()
  if (['combat', 'boss', 'confrontation', 'climax'].some((k: string) => arc.includes(k))) t += 3
  else if (['enigme', 'danger', 'fuite', 'piège'].some((k: string) => arc.includes(k))) t += 2
  else if (['exploration', 'dialogue', 'repos'].some((k: string) => arc.includes(k))) t -= 1
  if (s.trial) t += 2
  if (s.is_ending) t += 2
  return Math.min(10, Math.max(0, t))
}

// ── Accessibilité par BFS depuis §1 ──────────────────────────────────────────
function buildReachability(sections: any[]): Set<number> {
  const adjacency = new Map<number, number[]>()
  for (const s of sections) {
    const neighbors: number[] = []
    for (const c of s.choices ?? []) {
      const target = c.target_section ?? c.target
      if (typeof target === 'number') neighbors.push(target)
    }
    if (typeof s.trial?.success_section === 'number') neighbors.push(s.trial.success_section)
    if (typeof s.trial?.failure_section === 'number') neighbors.push(s.trial.failure_section)
    adjacency.set(s.number, neighbors)
  }
  const reachable = new Set<number>([1])
  const queue = [1]
  while (queue.length > 0) {
    const curr = queue.shift()!
    for (const next of adjacency.get(curr) ?? []) {
      if (!reachable.has(next)) { reachable.add(next); queue.push(next) }
    }
  }
  return reachable
}

// ── Route principale ─────────────────────────────────────────────────────────

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await _req.json().catch(() => ({}))
  const twoPass = !!(body as any).two_pass
  const phase = (body as any).phase as 'skeleton' | 'enrich' | undefined

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => {
        try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`)) } catch {}
      }

      try {
    const { data: book, error } = await supabaseAdmin.from('books').select('*').eq('id', id).single()
    if (error || !book) { send({ type: 'error', error: 'Livre introuvable', code: 404 }); return }

    if (!twoPass) {
      // Mode standard : vérifier le 409 AVANT de supprimer quoi que ce soit
      await supabaseAdmin.from('books').update({ skeleton_cache: null }).eq('id', id)
      if (book.phase && book.phase !== 'draft') {
        const { count } = await supabaseAdmin.from('sections').select('id', { count: 'exact', head: true }).eq('book_id', id)
        if ((count ?? 0) > 0) {
          send({ type: 'error', error: 'La structure a déjà été générée', code: 409 }); return
        }
        await supabaseAdmin.from('books').update({ phase: 'draft', acts: null }).eq('id', id)
      }
      // Le 409 est écarté : on peut maintenant nettoyer sections/NPCs/items/lieux
      // (choices supprimées en cascade via sections ON DELETE CASCADE)
      await supabaseAdmin.from('sections').delete().eq('book_id', id)
      await supabaseAdmin.from('npcs').delete().eq('book_id', id)
      await supabaseAdmin.from('items').delete().eq('book_id', id)
      await supabaseAdmin.from('locations').delete().eq('book_id', id)
    } else {
      // Mode 2 passes (squelette ou enrichissement) : nettoyer immédiatement
      await supabaseAdmin.from('npcs').delete().eq('book_id', id)
      await supabaseAdmin.from('items').delete().eq('book_id', id)
      await supabaseAdmin.from('locations').delete().eq('book_id', id)
    }

    const totalSections = book.num_sections ?? 30

    // Validation rapide du cache en passe enrichissement (avant de générer NPCs/items)
    if (twoPass && phase === 'enrich') {
      const cacheCheck = book.skeleton_cache as any
      if (!cacheCheck?.segments?.length) {
        send({ type: 'error', error: 'Aucun squelette en cache — relancez la passe squelette', code: 400 }); return
      }
    }

    // ── ÉTAPE 0b : Extraction des types d'armes depuis le synopsis ────────────
    let bookWeaponTypes: string[] = []
    const synopsisSource = book.synopsis?.trim() || book.book_summary?.trim()
    if (synopsisSource) {
      const weaponMatch = synopsisSource.match(/types?\s+armes?\s*:\s*([^\n]+)/i)
      if (weaponMatch) {
        bookWeaponTypes = weaponMatch[1]
          .split(/[,;]+/)
          .map((s: string) => s.trim().toLowerCase().replace(/\s+/g, '_'))
          .filter(Boolean)
        if (!bookWeaponTypes.includes('main_nue')) bookWeaponTypes.unshift('main_nue')
        await supabaseAdmin.from('books').update({ weapon_types: bookWeaponTypes }).eq('id', id)
      }
    }
    if (bookWeaponTypes.length === 0) {
      bookWeaponTypes = ['main_nue']
    }

    // ── Chargement des types de combat existants ──────────────────────────────
    const { data: existingCombatTypes } = await supabaseAdmin
      .from('combat_types')
      .select('id, name, type, description')
      .eq('book_id', id)
    const combatTypesList = existingCombatTypes ?? []

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

    // ── ÉTAPE 0 : Structure narrative (ignorée en passe enrichissement) ──────
    let acts: BookAct[] | null = null
    let parallelStructure: ParallelBookStructure | null = null

    if (twoPass && phase === 'enrich') {
      // Passe enrichissement : squelette déjà en cache, on ne regénère pas la junction map
      send({ type: 'step', step: 0, label: 'Enrichissement — structure depuis le cache…' })
      send({ type: 'step_done', step: 0, detail: 'Squelette en cache' })
    } else {
    send({ type: 'step', step: 0, label: 'Structure narrative…' })
    const narrativeSource = book.synopsis?.trim() || book.book_summary?.trim()

    // Détection de chemins parallèles : champ has_branches activé OU synopsis contient "CHEMIN A/B"
    const hasParallelPaths = !!(book.has_branches ||
      (narrativeSource &&
        /CHEMIN\s+A/i.test(narrativeSource) &&
        /CHEMIN\s+B/i.test(narrativeSource)))

    if (narrativeSource && hasParallelPaths) {
      // ── Livres à chemins parallèles : carte de jonctions ──────────────────
      send({ type: 'step', step: '0a', label: 'Plan des chemins parallèles…' })

      // ── Plan forcé : si path_synopses complet, on bypasse Claude ─────────
      const ps = book.path_synopses as { trunk_start?: string; paths: Record<string, string>; trunk_end?: string } | null
      const pathKeys = ps ? Object.keys(ps.paths ?? {}).filter(k => ps.paths[k]?.trim()) : []
      const hasForcedMap = !!(ps?.trunk_start?.trim() && pathKeys.length >= 2 && ps?.trunk_end?.trim())

      if (hasForcedMap) {
        // Calcul des sections_count par proportion de synopsis
        const trunkStartLen = ps!.trunk_start!.length
        const trunkEndLen   = ps!.trunk_end!.length
        const pathLengths   = pathKeys.map(k => ps!.paths[k].length)
        const totalLen      = trunkStartLen + pathLengths.reduce((a, b) => a + b, 0) + trunkEndLen

        // Proportions → sections (arrondies, minimum par segment)
        const MIN_PATH_SECTIONS = Math.max(15, Math.round(totalSections * 0.20))
        const MIN_JUNCTION_SECTIONS = 5

        const rawStart = Math.round((trunkStartLen / totalLen) * totalSections)
        const rawEnd   = Math.round((trunkEndLen   / totalLen) * totalSections)
        const rawPaths = pathLengths.map(l => Math.round((l / totalLen) * totalSections))

        // Ajuster pour respecter les minimums et le total exact
        const startCount = Math.max(MIN_JUNCTION_SECTIONS, Math.min(rawStart, Math.round(totalSections * 0.20)))
        const endCount   = Math.max(MIN_JUNCTION_SECTIONS, Math.min(rawEnd,   Math.round(totalSections * 0.10)))
        const remaining  = totalSections - startCount - endCount
        const pathCounts = rawPaths.map(r => Math.max(MIN_PATH_SECTIONS, r))
        const pathSum    = pathCounts.reduce((a, b) => a + b, 0)
        // Redistribuer si la somme des chemins ne correspond pas au reste
        const scale = remaining / pathSum
        const scaledPaths = pathCounts.map((c, i) => {
          const scaled = Math.round(c * scale)
          return Math.max(MIN_PATH_SECTIONS, scaled)
        })
        // Ajustement final pour tomber pile sur totalSections
        const finalSum = startCount + endCount + scaledPaths.reduce((a, b) => a + b, 0)
        if (finalSum !== totalSections) scaledPaths[0] += totalSections - finalSum

        // Construire le plan
        const forcedMap: ParallelBookStructure = {
          junctions: [
            {
              id: 'start',
              name: 'Tronc commun — départ',
              paths: pathKeys,
              sections_count: startCount,
              synopsis: ps!.trunk_start!.slice(0, 200),
            },
            {
              id: 'end',
              name: 'Tronc commun — victoire',
              paths: pathKeys,
              sections_count: endCount,
              synopsis: ps!.trunk_end!.slice(0, 200),
            },
          ],
          paths: pathKeys.map((k, i) => ({
            id: k,
            label: `Chemin ${k}`,
            segments: [{
              from_junction: 'start',
              to_junction: 'end',
              sections_count: scaledPaths[i],
              synopsis: ps!.paths[k].slice(0, 200),
            }],
          })),
        }

        parallelStructure = forcedMap
        send({ type: 'step_done', step: '0a', detail: `Plan forcé depuis path_synopses — ${pathKeys.length} chemin(s) · start:${startCount}s · ${pathKeys.map((k, i) => `${k}:${scaledPaths[i]}s`).join(' · ')} · end:${endCount}s` })
      } else {

      // Validation de la junction map
      const validateJunctionMap = (parsed: any): string[] => {
        const errors: string[] = []
        if (!Array.isArray(parsed.junctions) || parsed.junctions.length < 2)
          errors.push('Il faut au moins 2 jonctions (start + end)')
        if (!Array.isArray(parsed.paths) || parsed.paths.length < 2)
          errors.push('Il faut au moins 2 chemins distincts')

        // Vérifier le total des sections (tolérance ±15% — le delta est redistribué automatiquement)
        const junctionTotal = (parsed.junctions ?? []).reduce((s: number, j: any) => s + (j.sections_count ?? 0), 0)
        const segmentTotal = (parsed.paths ?? []).reduce((s: number, p: any) =>
          s + (p.segments ?? []).reduce((ss: number, seg: any) => ss + (seg.sections_count ?? 0), 0), 0)
        const total = junctionTotal + segmentTotal
        if (total === 0)
          errors.push('sections_count manquants — tous les segments ont 0 sections')
        else if (Math.abs(total - totalSections) > Math.round(totalSections * 0.15))
          errors.push(`La somme des sections_count est ${total} au lieu de ${totalSections} (écart de ${Math.abs(total - totalSections)} > 15%) — révise la distribution`)

        // Vérifier que les jonctions ne sont pas trop grandes individuellement
        // La jonction "start" peut être plus large si pathSynopses définit un tronc commun long (jusqu'à 20%)
        const maxStartSize = book.path_synopses?.trunk_start ? Math.round(totalSections * 0.20) : Math.round(totalSections * 0.10)
        const maxOtherJunctionSize = Math.round(totalSections * 0.10)
        for (const j of parsed.junctions ?? []) {
          const maxSize = j.id === 'start' ? maxStartSize : maxOtherJunctionSize
          if ((j.sections_count ?? 0) > maxSize)
            errors.push(`Jonction "${j.name || j.id}" a ${j.sections_count} sections — maximum autorisé : ${maxSize} (${j.id === 'start' && book.path_synopses?.trunk_start ? '20' : '10'}% de ${totalSections})`)
        }

        // RÈGLE ANTI-ENTONNOIR 1 : cap cumulatif sur toutes les jonctions (≤ 25%)
        const maxJunctionsTotal = Math.round(totalSections * 0.25)
        if (junctionTotal > maxJunctionsTotal)
          errors.push(`Jonctions cumulées : ${junctionTotal} sections soit ${Math.round(junctionTotal / totalSections * 100)}% du total — maximum autorisé : ${maxJunctionsTotal} (25%). Réduis les jonctions et augmente les segments de chemins.`)

        // RÈGLE ANTI-ENTONNOIR 2 : chaque chemin doit avoir assez de sections exclusives (≥ 20%)
        const minPathSections = Math.round(totalSections * 0.20)
        for (const p of parsed.paths ?? []) {
          const pathTotal = (p.segments ?? []).reduce((s: number, seg: any) => s + (seg.sections_count ?? 0), 0)
          if (pathTotal < minPathSections)
            errors.push(`Chemin ${p.id} n'a que ${pathTotal} sections dans ses segments — minimum requis : ${minPathSections} (20% de ${totalSections}). Chaque chemin doit raconter une histoire substantielle.`)
        }

        // Vérifier que chaque chemin a des segments suffisamment longs
        for (const p of parsed.paths ?? []) {
          for (const seg of p.segments ?? []) {
            if ((seg.sections_count ?? 0) < 15)
              errors.push(`Chemin ${p.id}, segment ${seg.from_junction}→${seg.to_junction} : ${seg.sections_count} sections — minimum requis : 15`)
          }
        }

        return errors
      }

      // Log lisible du plan
      const logJunctionPlan = (parsed: any) => {
        const jTotal = (parsed.junctions ?? []).reduce((s: number, j: any) => s + (j.sections_count ?? 0), 0)
        const sTotal = (parsed.paths ?? []).reduce((s: number, p: any) =>
          s + (p.segments ?? []).reduce((ss: number, seg: any) => ss + (seg.sections_count ?? 0), 0), 0)
        const pct = totalSections > 0 ? Math.round(jTotal / totalSections * 100) : 0
        const lines: string[] = [`📋 Plan des chemins (jonctions: ${jTotal} sections = ${pct}% partagé, segments: ${sTotal} sections = ${100-pct}% exclusif) :`]
        for (const j of parsed.junctions ?? [])
          lines.push(`  Jonction "${j.name || j.id}" [${(j.paths ?? []).join(',')}] : ${j.sections_count} sections`)
        for (const p of parsed.paths ?? []) {
          const pathTotal = (p.segments ?? []).reduce((s: number, seg: any) => s + (seg.sections_count ?? 0), 0)
          lines.push(`  Chemin ${p.id} — ${p.label} (${pathTotal} sections exclusives)`)
          for (const seg of p.segments ?? [])
            lines.push(`    └ ${seg.from_junction} → ${seg.to_junction} : ${seg.sections_count} sections`)
        }
        send({ type: 'warn', message: lines.join('\n') })
      }

      try {
        let parsed: any = null
        let validationErrors: string[] = []

        const pathSynopses = book.path_synopses ?? undefined

        // Tentative 1
        const raw1 = await generateText('opus', system,
          buildJunctionMapPrompt(book.title, book.theme, narrativeSource, totalSections, undefined, pathSynopses), 8192)
        try { parsed = JSON.parse(extractJson(raw1)) } catch {}

        if (parsed?.junctions && parsed?.paths) {
          logJunctionPlan(parsed)
          validationErrors = validateJunctionMap(parsed)
        } else {
          validationErrors = ['La réponse JSON ne contient pas les champs "junctions" et "paths" requis']
        }

        // Retry si erreurs
        if (validationErrors.length > 0) {
          send({ type: 'warn', message: `⚠ Plan invalide (${validationErrors.length} erreur(s)) — retry…\n${validationErrors.map(e => `  · ${e}`).join('\n')}` })
          const raw2 = await generateText('opus', system,
            buildJunctionMapPrompt(book.title, book.theme, narrativeSource, totalSections, validationErrors, pathSynopses), 8192)
          try { parsed = JSON.parse(extractJson(raw2)) } catch { parsed = null }

          if (parsed?.junctions && parsed?.paths) {
            logJunctionPlan(parsed)
            validationErrors = validateJunctionMap(parsed)
          } else {
            validationErrors = ['Retry : réponse JSON invalide']
          }
        }

        // Arrêt si toujours invalide après retry
        if (validationErrors.length > 0) {
          send({ type: 'error', error: `Plan des chemins invalide après 2 tentatives — génération annulée.\n${validationErrors.map(e => `· ${e}`).join('\n')}\n\nCorrige le synopsis ou désactive les chemins parallèles.`, code: 422 })
          return
        }

        parallelStructure = parsed as ParallelBookStructure
        const pathCount = parsed.paths.length
        const junctionCount = parsed.junctions.length
        send({ type: 'step_done', step: '0a', detail: `${pathCount} chemin(s) · ${junctionCount} jonction(s) — plan validé` })
      } catch (e: any) {
        send({ type: 'warn', message: `⚠ Chemins parallèles échoués (${e?.message?.slice(0, 80)}) — fallback linéaire` })
      }
      } // fin else (plan Claude)
    } else if (narrativeSource) {
      // ── Livres linéaires : découpe en actes ───────────────────────────────
      try {
        const actsRaw = await generateText(
          'opus', system,
          buildActSplitPrompt(book.title, book.theme, narrativeSource, totalSections),
          4096
        )
        const parsed = JSON.parse(extractJson(actsRaw))
        if (Array.isArray(parsed) && parsed.length >= 2) {
          acts = parsed as BookAct[]
          await supabaseAdmin.from('books').update({ acts }).eq('id', id)
        }
      } catch {
        // non bloquant
      }
    }
    } // fin du else (pas de passe enrichissement)

    // ── ÉTAPE 1 : PNJ + Lieux ─────────────────────────────────────────────────
    // En passe squelette : PNJ et objets reportés à la passe enrichissement
    let npcStructure: { npcs?: any[]; locations?: any[] } = {}
    const locationNameMap = new Map<string, string>()
    const locationNames: string[] = []
    const npcNameMap = new Map<string, any>()
    const npcNames: string[] = []
    let insertedNpcsDb: any[] = []

    if (twoPass && !phase) {
      send({ type: 'step', step: 1, label: 'Passe squelette — PNJ reportés à l\'enrichissement…' })
      send({ type: 'step_done', step: 1, detail: 'Seront générés lors de l\'enrichissement' })
    } else {
      send({ type: 'step', step: 1, label: 'Génération des PNJ et lieux…' })
      const npcRaw = await generateText('opus', system, buildNpcLocationPrompt(bookParams, seriesBible, bookWeaponTypes), 16000)
      try { npcStructure = JSON.parse(extractJson(npcRaw)) } catch { throw new Error(`JSON PNJ invalide : ${npcRaw.slice(0, 400)}`) }

      if (npcStructure.locations?.length && book.map_style) {
        const { data: insertedLocs } = await supabaseAdmin.from('locations').insert(npcStructure.locations.map((l: any) => ({
          book_id: id, name: l.name,
          x: Math.min(100, Math.max(0, l.x ?? 50)), y: Math.min(100, Math.max(0, l.y ?? 50)), icon: l.icon ?? '📍',
        }))).select()
        for (const loc of insertedLocs ?? []) { locationNameMap.set(loc.name.toLowerCase(), loc.id); locationNames.push(loc.name) }
      }

      if (npcStructure.npcs?.length) {
        const { data: ins } = await supabaseAdmin.from('npcs').upsert(
          npcStructure.npcs.map((n: any) => ({
            book_id: id, name: n.name, type: normalizeNpcType(n.type),
            description: n.description ?? null, appearance: n.appearance ?? null,
            origin: n.origin ?? null, group_name: n.group_name ?? null,
            force: n.force ?? 5, agilite: n.agilite ?? 5,
            intelligence: n.intelligence ?? 5, magie: n.magie ?? 0, endurance: n.endurance ?? 10,
            chance: n.chance ?? 5, special_ability: n.special_ability ?? null,
            resistances: n.resistances ?? null, loot: n.loot ?? null,
            speech_style: n.speech_style ?? null, dialogue_intro: n.dialogue_intro ?? null,
          })),
          { onConflict: 'book_id,name', ignoreDuplicates: false }
        ).select()
        insertedNpcsDb = ins ?? []
        for (const npc of insertedNpcsDb) {
          npcNameMap.set(npc.name.toLowerCase(), { id: npc.id, force: npc.force, agilite: npc.agilite, endurance: npc.endurance })
          npcNames.push(npc.name)
        }
      }
      send({ type: 'step_done', step: 1, detail: `${npcNames.length} PNJ · ${locationNames.length} lieu(x)` })
    }

    // ── Assignations combat (vide en passe squelette) ──────────────────────────
    const combatAssignments = new Map<number, { npc_id: string; npc_name: string; enemy_weapon_type: string }>()
    for (const npc of npcStructure.npcs ?? []) {
      if (!npc.combat_sections || !Array.isArray(npc.combat_sections)) continue
      const insertedNpc = npcNameMap.get(npc.name?.toLowerCase())
      if (!insertedNpc) continue
      for (const secNum of npc.combat_sections) {
        combatAssignments.set(secNum, { npc_id: insertedNpc.id, npc_name: npc.name, enemy_weapon_type: npc.weapon_type ?? 'main_nue' })
      }
    }

    // ── ÉTAPE 1b : Objets ─────────────────────────────────────────────────────
    // En passe squelette : objets reportés à l'enrichissement
    let items_count = 0
    let itemCatalogue: Array<{ id: string; name: string; category: string; pickup_section_numbers: number[]; use_section_numbers: number[] }> = []
    let rawItemsData: Array<{ id: string; pickup_section_numbers: number[]; use_section_numbers: number[]; locked_hint: string }> = []

    if (twoPass && !phase) {
      send({ type: 'step', step: '1b', label: 'Passe squelette — objets reportés à l\'enrichissement…' })
      send({ type: 'step_done', step: '1b', detail: 'Seront générés lors de l\'enrichissement' })
    } else {
      send({ type: 'step', step: '1b', label: 'Génération des objets…' })
      const synopsisForItems = book.synopsis?.trim() || book.book_summary?.trim() || `Livre "${book.title}" (${book.theme})`
      const enemyWeapons = (npcStructure.npcs ?? [])
        .filter((n: any) => n.weapon_type && n.weapon_type !== 'main_nue' && n.combat_sections?.length)
        .map((n: any) => ({ npc_name: n.name, weapon_type: n.weapon_type, combat_sections: n.combat_sections }))
      if (synopsisForItems) {
        try {
          const VALID_ITEM_TYPES = new Set(['soin', 'mana', 'arme', 'armure', 'outil', 'quete', 'grimoire'])
          const VALID_CATEGORIES = new Set(['persistant', 'consommable', 'arme'])
          const itemsRaw = await generateText('opus', system, buildItemsPrompt(book.title, book.theme, synopsisForItems, totalSections, enemyWeapons, bookWeaponTypes), 8192)
          let itemsArr: any[]
          try { itemsArr = JSON.parse(extractJson(itemsRaw)) } catch (parseErr: any) {
            send({ type: 'warn', message: `⚠ Items : JSON non parseable — ${parseErr.message}` }); itemsArr = []
          }
          if (!Array.isArray(itemsArr)) { send({ type: 'warn', message: `⚠ Items : réponse non-tableau` }); itemsArr = [] }
          send({ type: 'warn', message: `ℹ Items : ${itemsArr.length} item(s) bruts reçus` })
          if (itemsArr.length > 0) {
            const filtered = itemsArr.filter((it: any) => it.name && VALID_ITEM_TYPES.has(it.item_type))
            if (filtered.length < itemsArr.length) {
              const rejected = itemsArr.filter((it: any) => !VALID_ITEM_TYPES.has(it.item_type))
              send({ type: 'warn', message: `⚠ Items : ${itemsArr.length - filtered.length} rejeté(s) — types : ${[...new Set(rejected.map((i: any) => i.item_type))].join(', ')}` })
            }
            const itemsToInsert = filtered.map((it: any) => ({
              book_id: id, name: it.name, item_type: it.item_type,
              category: VALID_CATEGORIES.has(it.category) ? it.category : 'consommable',
              description: it.description ?? null, effect: it.effect ?? {},
              sections_used: [], use_section_ids: [],
              radio_broadcasts: Array.isArray(it.radio_broadcasts) ? it.radio_broadcasts : [],
              weapon_type: it.item_type === 'arme' ? (it.weapon_type ?? bookWeaponTypes.find((w: string) => w !== 'main_nue') ?? 'main_nue') : null,
              pickup_section_numbers: it.pickup_section_numbers ?? [],
            }))
            if (itemsToInsert.length > 0) {
              const { data: insertedItems, error: itemsError } = await supabaseAdmin.from('items').insert(itemsToInsert).select()
              if (itemsError) { send({ type: 'warn', message: `⚠ Items insert DB échoué : ${itemsError.message}` }) }
              else if (insertedItems) {
                items_count = insertedItems.length
                itemCatalogue = insertedItems.map((item: any, i: number) => ({
                  id: item.id, name: item.name, category: item.category,
                  pickup_section_numbers: filtered[i]?.pickup_section_numbers ?? [],
                  use_section_numbers: filtered[i]?.use_section_numbers ?? [],
                }))
                rawItemsData = insertedItems.map((item: any, i: number) => ({
                  id: item.id,
                  pickup_section_numbers: filtered[i]?.pickup_section_numbers ?? [],
                  use_section_numbers: filtered[i]?.use_section_numbers ?? [],
                  locked_hint: filtered[i]?.locked_hint ?? '',
                }))
              }
            }
          }
        } catch (itemsErr: any) { send({ type: 'warn', message: `⚠ Items étape échouée : ${itemsErr?.message}` }) }
      }
      send({ type: 'step_done', step: '1b', detail: `${items_count} objet(s)` })
    }

    // ── PHASE ENRICHISSEMENT (passe 2 du mode 2 passes) ──────────────────────
    // NPCs et objets viennent d'être générés ci-dessus — on enrichit le squelette en cache
    if (twoPass && phase === 'enrich') {
      const cache = book.skeleton_cache as any
      // Supprimer les sections existantes (cas de relance d'enrichissement)
      await supabaseAdmin.from('sections').delete().eq('book_id', id)
      // combatTypesList déjà chargé au-dessus (portée parente)
      const dbNpcs = insertedNpcsDb

      send({ type: 'step', step: 2, label: 'Enrichissement des sections depuis le squelette…' })
      const allRawSections: any[] = [...(cache.junctionSections ?? [])]
      send({ type: 'warn', message: `ℹ ${cache.junctionSections?.length ?? 0} section(s) de jonction restaurées depuis le cache` })

      let enrichBatchIdx = 0
      for (const seg of cache.segments) {
        const skeletonSections: any[] = seg.skeleton ?? []
        const skeletonMap = new Map<number, any>(skeletonSections.map((s: any) => [s.number, s]))
        const enrichChunks = Math.ceil(skeletonSections.length / BATCH_SIZE)
        for (let c = 0; c < enrichChunks; c++) {
          const skeletonBatch = skeletonSections.slice(c * BATCH_SIZE, (c + 1) * BATCH_SIZE)
          const fromB = skeletonBatch[0]?.number ?? 0
          const toB = skeletonBatch[skeletonBatch.length - 1]?.number ?? 0
          enrichBatchIdx++
          send({ type: 'batch', batch: enrichBatchIdx, from: fromB, to: toB, label: `Enrichissement §${fromB}–§${toB} [${seg.pathId}]…` })
          let enrichedSections: any[] = skeletonBatch
          try {
            const enrichedRaw = await generateText('opus', system,
              buildEnrichmentPrompt(bookParams, npcNames, locationNames, skeletonBatch, seriesBible), 16000)
            const enrichedParsed = JSON.parse(extractJson(enrichedRaw))
            if (Array.isArray(enrichedParsed.sections) && enrichedParsed.sections.length > 0) {
              enrichedSections = enrichedParsed.sections.map((enriched: any) => {
                const skel = skeletonMap.get(enriched.number)
                if (!skel) return enriched
                return { ...enriched, number: skel.number, choices: skel.choices, trial: skel.trial, is_ending: skel.is_ending, ending_type: skel.ending_type }
              })
            }
          } catch { send({ type: 'warn', message: `⚠ Enrichissement §${fromB}–§${toB} échoué — squelette utilisé` }) }
          allRawSections.push(...enrichedSections)
          send({ type: 'batch_done', batch: enrichBatchIdx, from: fromB, to: toB, count: enrichedSections.length })
        }
      }
      await supabaseAdmin.from('books').update({ skeleton_cache: null }).eq('id', id)

      // Dédupliquer par numéro (sécurité : LLM hors plage ou sections jonction dupliquées)
      const uniqueRawSectionsE = Array.from(new Map(allRawSections.map((s: any) => [s.number, s])).values())
      const sectionsToInsertE = uniqueRawSectionsE.map((s: any) => ({
        book_id: id, number: s.number, summary: s.summary ?? null, hint_text: s.hint ?? null,
        content: '', is_ending: s.is_ending ?? false, ending_type: normalizeEndingType(s.ending_type),
        trial: null, narrative_arc: s.narrative_arc ?? null,
        location_id: s.location_name ? (locationNameMap.get(s.location_name.toLowerCase()) ?? null) : null,
        tension_level: (s.tension_level != null && s.tension_level >= 1 && s.tension_level <= 5)
          ? s.tension_level : calcTension(s, totalSections),
        status: 'draft',
        items_on_scene: itemCatalogue.filter(it => it.pickup_section_numbers.includes(s.number)).map(it => ({ item_id: it.id })),
      }))
      const { data: insertedSectionsE, error: sectionsErrorE } = await supabaseAdmin.from('sections').insert(sectionsToInsertE).select()
      if (sectionsErrorE) throw sectionsErrorE
      const sectionMapE = new Map<number, string>(insertedSectionsE.map((s: any) => [s.number, s.id]))

      const choicesToInsertE: any[] = []
      for (const s of uniqueRawSectionsE) {
        const sId = sectionMapE.get(s.number)
        if (!sId || !s.choices?.length) continue
        for (const c of s.choices) {
          const targetId = sectionMapE.get(c.target_section ?? c.target) ?? null
          if (!targetId) continue
          choicesToInsertE.push({ section_id: sId, label: c.label, locked_label: c.locked_label ?? null, archetype: c.archetype ?? null, target_section_id: targetId, requires_trial: false, condition: c.condition ?? null, sort_order: c.sort_order ?? 0, is_back: c.is_back ?? false })
        }
      }
      if (choicesToInsertE.length > 0) {
        const { error: choicesErrE } = await supabaseAdmin.from('choices').insert(choicesToInsertE)
        if (choicesErrE) send({ type: 'warn', message: `⚠ Insertion choix échouée : ${choicesErrE.message}` })
      }

      for (const s of uniqueRawSectionsE) {
        if (!s.trial) continue
        const sId = sectionMapE.get(s.number)
        if (!sId) continue
        const rawTrial = s.trial
        if (rawTrial.type === 'combat') {
          const assignment = combatAssignments.get(s.number)
          if (assignment) { rawTrial.npc_id = assignment.npc_id; rawTrial.enemy_weapon_type = assignment.enemy_weapon_type; rawTrial.enemy_name = assignment.npc_name }
        }
        const trial: Record<string, any> = {
          type: rawTrial.type, stat: rawTrial.stat,
          success_section_id: sectionMapE.get(rawTrial.success_section) ?? null,
          failure_section_id: sectionMapE.get(rawTrial.failure_section) ?? null,
          endurance_loss_on_failure: rawTrial.endurance_loss_on_failure ?? null,
          mana_cost: rawTrial.mana_cost ?? null, xp_reward: rawTrial.xp_reward ?? null,
          item_rewards: rawTrial.item_rewards ?? null,
          dialogue_opening: rawTrial.dialogue_opening ?? null, dialogue_goal: rawTrial.dialogue_goal ?? null,
        }
        if (rawTrial.type === 'combat') {
          if (Array.isArray(rawTrial.enemies) && rawTrial.enemies.length > 0) {
            trial.enemies = rawTrial.enemies.map((e: any) => {
              const npc = npcNameMap.get((e.npc_name ?? '').toLowerCase())
              return { npc_id: npc?.id ?? null, npc_name: e.npc_name, force: e.force ?? npc?.force ?? 5, endurance: e.endurance ?? npc?.endurance ?? 10, enemy_weapon_type: e.enemy_weapon_type ?? null }
            })
            const first = trial.enemies[0]
            trial.npc_id = first.npc_id; trial.enemy = { name: first.npc_name, force: first.force, endurance: first.endurance }
            trial.enemy_weapon_type = first.enemy_weapon_type ?? rawTrial.enemy_weapon_type ?? null
          } else {
            const npcData = rawTrial.enemy_name ? npcNameMap.get(rawTrial.enemy_name.toLowerCase()) : null
            if (npcData) { trial.npc_id = rawTrial.npc_id ?? npcData.id; trial.enemy = rawTrial.enemy ?? { name: rawTrial.enemy_name, force: npcData.force, endurance: npcData.endurance } }
            if (rawTrial.enemy_weapon_type) trial.enemy_weapon_type = rawTrial.enemy_weapon_type
          }
        }
        await supabaseAdmin.from('sections').update({ trial }).eq('id', sId)
        if (rawTrial.combat_type_id && combatTypesList.some((ct: any) => ct.id === rawTrial.combat_type_id))
          await supabaseAdmin.from('sections').update({ combat_type_id: rawTrial.combat_type_id }).eq('id', sId)
      }

      for (const rawItem of rawItemsData) {
        const sections_used = rawItem.pickup_section_numbers.map((n: number) => sectionMapE.get(n)).filter(Boolean) as string[]
        const use_section_ids = rawItem.use_section_numbers.map((n: number) => sectionMapE.get(n)).filter(Boolean) as string[]
        if (sections_used.length > 0 || use_section_ids.length > 0)
          await supabaseAdmin.from('items').update({ sections_used, use_section_ids }).eq('id', rawItem.id)
      }

      const actualCountE = insertedSectionsE.length
      await supabaseAdmin.from('books').update({ phase: 'structure_generated', num_sections: actualCountE }).eq('id', id)
      send({ type: 'step_done', step: 2, detail: `${uniqueRawSectionsE.length} section(s) enrichies · ${actualCountE} insérées en base` })

      send({ type: 'step', step: 3, label: 'Assignation des compagnons…' })
      let companions_assignedE = 0
      try {
        const companionNpcs = dbNpcs.filter((n: any) => n.type === 'allié' || n.type === 'neutre').map((n: any) => ({ name: n.name, type: n.type }))
        if (companionNpcs.length > 0) {
          const synopsis = book.synopsis?.trim() || book.book_summary?.trim() || book.theme
          const companionLines = companionNpcs.map((n: any) => `- ${n.name} (${n.type})`).join('\n')
          const companionIdByName = new Map(dbNpcs.filter((n: any) => n.type === 'allié' || n.type === 'neutre').map((n: any) => [n.name.toLowerCase(), n.id]))
          const COMPANION_BATCH = 60
          for (let i = 0; i < allRawSections.length; i += COMPANION_BATCH) {
            const batchSecs = allRawSections.slice(i, i + COMPANION_BATCH)
            const previousContext = allRawSections.slice(0, i).map((s: any) => `§${s.number}: ${s.summary ?? ''}`).slice(-20).join('\n')
            const sectionLines = batchSecs.map((s: any) => `§${s.number}${s.trial?.type === 'combat' ? ' (COMBAT)' : s.is_ending ? ' (FIN)' : ''}: ${s.summary ?? '(sans résumé)'}`).join('\n')
            try {
              const msg = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001', max_tokens: 8192,
                messages: [{ role: 'user', content: `Tu es l'auteur d'un livre "Dont Vous Êtes le Héros" : "${book.title}"\n\nSynopsis :\n${synopsis}\n\nAlliés du protagoniste :\n${companionLines}\n\nRÈGLE : Les alliés accompagnent le protagoniste par défaut dans les sections de narration. Ils sont ABSENTS uniquement si :\n- Le résumé de la section indique explicitement qu'ils sont morts, partis, capturés, ou que c'est une scène solo\n- La section est marquée (COMBAT) — les alliés ne participent pas aux combats du protagoniste\n- La section est marquée (FIN)\n- Le contexte précédent montre clairement qu'ils ont quitté l'histoire\n\n${previousContext ? `Contexte des sections précédentes (pour détecter morts/départs d'alliés) :\n${previousContext}\n\n` : ''}Sections à traiter :\n${sectionLines}\n\nRéponds UNIQUEMENT avec le JSON brut, sans texte avant ni après (TOUTES les sections, même celles avec companions:[]) : [{"number":1,"companions":["Nom1"]},{"number":2,"companions":[]},...]` }],
              })
              const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
              const assignments: { number: number; companions: string[] }[] = JSON.parse(extractJson(raw))
              for (const a of assignments) {
                const sId = sectionMapE.get(a.number)
                if (!sId || !a.companions?.length) continue
                const ids = a.companions.map((name: string) => companionIdByName.get(name.toLowerCase())).filter(Boolean) as string[]
                if (!ids.length) continue
                const { error: updateErr } = await supabaseAdmin.from('sections').update({ companion_npc_ids: ids }).eq('id', sId)
                if (updateErr) send({ type: 'warn', message: `⚠ Compagnon §${a.number} update échoué : ${updateErr.message}` })
                else companions_assignedE += ids.length
              }
            } catch (batchErr: any) {
              send({ type: 'warn', message: `⚠ Compagnons lot ${Math.floor(i / COMPANION_BATCH) + 1} échoué : ${batchErr?.message ?? 'erreur inconnue'}` })
            }
          }
        }
      } catch { /* non bloquant */ }
      send({ type: 'step_done', step: 3, detail: `${companions_assignedE} assignation(s)` })

      send({ type: 'step', step: 4, label: 'Auto-réparation…' })
      let validationE = { fixed: 0, remaining_critical: 0, log: [] as string[] }
      try { validationE = await runAutoRepair(id, npcNameMap, totalSections) } catch (e: any) { validationE.log.push(`⚠ ${e.message}`) }
      send({ type: 'step_done', step: 4, detail: `${validationE.fixed} correction(s) · ${validationE.remaining_critical} critique(s)`, log: validationE.log })

      send({ type: 'step', step: 5, label: 'Textes de transition…' })
      let transitions_generatedE = 0
      try {
        const summaryByIdE = new Map<string, string>(insertedSectionsE.map((s: any) => [s.id, s.summary ?? '']))
        const { data: allChoicesE } = await supabaseAdmin.from('choices').select('id, section_id, target_section_id, label').in('section_id', insertedSectionsE.map((s: any) => s.id))
        const validChoicesE = (allChoicesE ?? []).filter((c: any) => c.target_section_id && summaryByIdE.get(c.section_id) && summaryByIdE.get(c.target_section_id))
        const styleNote = book.age_range === '8-12' ? 'Écris pour un jeune public (8-12 ans).' : book.age_range === '13-17' ? 'Écris pour des adolescents.' : 'Style Pierre Bordage : 2e personne, immersif.'
        for (let i = 0; i < validChoicesE.length; i += 5) {
          await Promise.all(validChoicesE.slice(i, i + 5).map(async (choice: any) => {
            try {
              const [mt, mr] = await Promise.all([
                anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: `Livre "${book.title}" (${book.theme}). Transition (2-3 phrases) pour le choix "${choice.label}".\nDépart: ${summaryByIdE.get(choice.section_id)}\nArrivée: ${summaryByIdE.get(choice.target_section_id)}\n${styleNote}` }] }),
                anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: `Livre "${book.title}". Texte de retour (2-3 phrases, ton mémoriel) après avoir visité: ${summaryByIdE.get(choice.target_section_id)}.\nRetour à: ${summaryByIdE.get(choice.section_id)}.\n${styleNote}` }] }),
              ])
              const update: any = {}
              const tt = mt.content[0].type === 'text' ? mt.content[0].text.trim() : ''
              const rt = mr.content[0].type === 'text' ? mr.content[0].text.trim() : ''
              if (tt) update.transition_text = tt
              if (rt) update.return_text = rt
              if (Object.keys(update).length) { await supabaseAdmin.from('choices').update(update).eq('id', choice.id); transitions_generatedE++ }
            } catch { /* non bloquant */ }
          }))
        }
      } catch { /* non bloquant */ }
      send({ type: 'step_done', step: 5, detail: `${transitions_generatedE} transition(s)` })

      send({ type: 'done', result: {
        sections_count: actualCountE, sections_target: totalSections,
        npcs_count: insertedNpcsDb.length, items_count: itemCatalogue.length,
        choices_count: choicesToInsertE.length, acts_count: 0,
        companions_assigned: companions_assignedE, validation: validationE,
        transitions_generated: transitions_generatedE,
      }})
      return
    }

    // ── ÉTAPE 2 : Sections par lots ───────────────────────────────────────────
    send({ type: 'step', step: 2, label: twoPass && !phase ? 'Génération du squelette de navigation…' : 'Génération des sections par lots…' })
    const allRawSections: any[] = []
    let previousSummaries: string[] = []
    const condensedBatchHistory: string[] = []       // P1.2 — résumé par lot
    const endingsCount = { victory: 0, death: 0 }   // P1.4 — compteur fins
    let lastSectionWasCombat = false                 // P2.5 — type dernière section
    const defeatedEnemies: Array<{ npc_name: string; section: number }> = []  // persistance ennemis vaincus

    // sectionMap alimenté par batch (sauf en mode squelette où les sections vont au cache)
    const sectionMap = new Map<number, string>()
    const insertBatchToDB = !(twoPass && !phase) // false = passe squelette → pas d'insert DB

    let batchIndex = 0
    const generateBatch = async (
      from: number,
      to: number,
      isLastBatch: boolean,
      actInfo?: { title: string; synopsis: string; actNumber: number },
      pathCtx?: import('@/lib/prompts').PathBatchContext,
      resetContext = false,  // P2.3 — reset previousSummaries entre chemins parallèles
      corrections?: string   // corrections obligatoires à injecter dans le prompt
    ) => {
      if (resetContext) previousSummaries = []
      batchIndex++
      send({ type: 'batch', batch: batchIndex, from, to, label: `Lot §${from}–§${to}…` })

      const buildPrompt = () => buildSectionBatchPrompt(
        bookParams, npcNames, locationNames, from, to, totalSections, isLastBatch,
        previousSummaries, actInfo, corrections, seriesBible,
        itemCatalogue.length > 0 ? itemCatalogue : undefined,
        combatAssignments.size > 0 ? combatAssignments : undefined,
        combatTypesList, pathCtx,
        {
          condensedHistory: condensedBatchHistory.length > 0 ? condensedBatchHistory.join('\n') : undefined,
          endingsCount: { ...endingsCount },
          progressInBook: Math.round((from / totalSections) * 100),
          lastSectionWasCombat,
          defeatedEnemies: defeatedEnemies.length > 0 ? [...defeatedEnemies] : undefined,
        }
      )

      let batchStructure: { sections: any[] }
      try {
        const batchRaw = await generateText('opus', system, buildPrompt(), 16000)
        const parsed = JSON.parse(extractJson(batchRaw))
        if (!Array.isArray(parsed.sections)) throw new Error('pas de tableau "sections"')
        batchStructure = parsed
      } catch (e1: any) {
        send({ type: 'warn', message: `⚠ Lot §${from}-§${to} échoué (${e1?.message?.slice(0, 80)}) — retry…` })
        try {
          const batchRaw2 = await generateText('opus', system, buildPrompt(), 16000)
          const parsed2 = JSON.parse(extractJson(batchRaw2))
          if (!Array.isArray(parsed2.sections)) throw new Error('pas de tableau "sections"')
          batchStructure = parsed2
        } catch (e2: any) {
          throw new Error(`Lot §${from}-§${to} invalide après 2 tentatives : ${e2?.message?.slice(0, 200)}`)
        }
      }
      const inRangeSections = batchStructure.sections.filter((s: any) => s.number >= from && s.number <= to)
      allRawSections.push(...inRangeSections)

      // Diagnostic : vérifier que le LLM génère bien des choix
      const withChoices = batchStructure.sections.filter((s: any) => Array.isArray(s.choices) && s.choices.length > 0).length
      const withTrial = batchStructure.sections.filter((s: any) => s.trial).length
      if (withChoices === 0 && withTrial < batchStructure.sections.length) {
        send({ type: 'warn', message: `⚠ Lot §${from}-§${to} : aucun choix généré (${withTrial}/${batchStructure.sections.length} sections ont un trial)` })
      }

      // P1.4 — comptabiliser les fins générées (uniquement sections en plage)
      for (const s of inRangeSections) {
        if (s.is_ending) {
          if (s.ending_type === 'victory') endingsCount.victory++
          else endingsCount.death++
        }
      }

      // P2.5 — mémoriser si la dernière section était un combat
      const lastSec = inRangeSections[inRangeSections.length - 1]
      lastSectionWasCombat = lastSec?.trial?.type === 'combat'

      // Tracker les ennemis vaincus (pour la persistance inter-lots)
      for (const s of inRangeSections) {
        if (s.trial?.type === 'combat') {
          const enemies: any[] = s.trial.enemies ?? (s.trial.enemy_name ? [{ npc_name: s.trial.enemy_name }] : [])
          for (const e of enemies) {
            if (e.npc_name && !defeatedEnemies.some(d => d.npc_name === e.npc_name)) {
              defeatedEnemies.push({ npc_name: e.npc_name, section: s.number })
            }
          }
        }
      }

      // P1.2 — construire le résumé condensé de ce lot (première + dernière section)
      const first = inRangeSections[0]
      const last = inRangeSections[inRangeSections.length - 1]
      if (first && last) {
        const recap = first.number === last.number
          ? `§${first.number}: ${(first.summary ?? '').slice(0, 80)}`
          : `§${first.number}-§${last.number}: ${(first.summary ?? '').slice(0, 60)} … ${(last.summary ?? '').slice(0, 60)}`
        condensedBatchHistory.push(recap)
      }

      // Garder les 10 dernières sections pour la continuité immédiate
      previousSummaries = inRangeSections
        .slice(-10)
        .map((s: any) => `§${s.number} : "${s.summary ?? ''}"`)

      if (inRangeSections.length < (to - from + 1))
        send({ type: 'warn', message: `⚠ Lot §${from}-§${to} : ${inRangeSections.length}/${to - from + 1} sections en plage (${batchStructure.sections.length - inRangeSections.length} hors plage ignorées)` })

      // ── Insertion immédiate en DB (sauf passe squelette) ──────────────────────
      if (insertBatchToDB && inRangeSections.length > 0) {
        const toInsert = inRangeSections.map((s: any) => ({
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
          tension_level: (s.tension_level != null && s.tension_level >= 1 && s.tension_level <= 5)
            ? s.tension_level : calcTension(s, totalSections),
          status:        'draft',
          items_on_scene: itemCatalogue
            .filter(it => it.pickup_section_numbers.includes(s.number))
            .map(it => ({ item_id: it.id })),
        }))
        const { data: inserted, error: insertErr } = await supabaseAdmin.from('sections').insert(toInsert).select()
        if (insertErr) throw insertErr
        for (const s of inserted ?? []) sectionMap.set(s.number, s.id)
      }

      send({ type: 'batch_done', batch: batchIndex, from, to, count: inRangeSections.length })
    }

    if (parallelStructure) {
      // ── Génération à chemins parallèles ─────────────────────────────────────

      // 1. Assigner les plages de sections
      let cursor = 1
      const assignedJunctions = parallelStructure.junctions.map(j => ({ ...j }))
      const assignedPaths = parallelStructure.paths.map(p => ({
        ...p,
        segments: p.segments.map(s => ({ ...s })),
      }))

      // Calcul du total déclaré vs totalSections — distribuer le delta proportionnellement (P1.3)
      const declaredTotal =
        assignedJunctions.reduce((s, j) => s + j.sections_count, 0) +
        assignedPaths.reduce((s, p) => s + p.segments.reduce((ss, seg) => ss + seg.sections_count, 0), 0)
      const delta = totalSections - declaredTotal
      if (delta !== 0) {
        // Collecter tous les segments de tous les chemins
        const allSegments = assignedPaths.flatMap(p => p.segments)
        if (allSegments.length > 0) {
          const totalSegCount = allSegments.reduce((s, seg) => s + seg.sections_count, 0)
          let distributed = 0
          // Distribuer proportionnellement, les restes vont aux segments les plus grands
          for (let i = 0; i < allSegments.length; i++) {
            const share = i < allSegments.length - 1
              ? Math.round(delta * (allSegments[i].sections_count / totalSegCount))
              : delta - distributed
            allSegments[i].sections_count = Math.max(1, allSegments[i].sections_count + share)
            distributed += share
          }
        }
      }

      // Construire un résumé d'allocation pour le contexte des prompts
      const buildAllocationSummary = () => {
        const parts: string[] = []
        for (const j of assignedJunctions) {
          if (j.from_section) parts.push(`Jonction "${j.name}": §${j.from_section}-§${j.to_section} [${j.paths.join(',')}]`)
        }
        for (const p of assignedPaths) {
          for (const seg of p.segments) {
            if (seg.from_section) parts.push(`Chemin ${p.id} (${seg.from_junction}→${seg.to_junction}): §${seg.from_section}-§${seg.to_section}`)
          }
        }
        return parts.join(' | ')
      }

      // Parcours en ordre narratif : jonction → segments issus → jonction suivante…
      // On génère jonction par jonction, avec tous les segments qui en partent
      const processedJunctions = new Set<string>()
      const junctionByName = new Map(assignedJunctions.map(j => [j.id, j]))

      // Assignation des plages : parcourir dans l'ordre naturel (jonctions + segments intercalés)
      const orderedBatches: Array<{ from: number; to: number; type: 'junction' | 'segment'; junction?: typeof assignedJunctions[0]; path?: typeof assignedPaths[0]; segment?: typeof assignedPaths[0]['segments'][0] }> = []

      for (const junction of assignedJunctions) {
        junction.from_section = cursor
        junction.to_section = cursor + junction.sections_count - 1
        cursor += junction.sections_count
        orderedBatches.push({ from: junction.from_section, to: junction.to_section!, type: 'junction', junction })
        processedJunctions.add(junction.id)

        // Ajouter les segments qui PARTENT de cette jonction
        for (const path of assignedPaths) {
          for (const seg of path.segments) {
            if (seg.from_junction === junction.id) {
              seg.from_section = cursor
              seg.to_section = cursor + seg.sections_count - 1
              cursor += seg.sections_count
              orderedBatches.push({ from: seg.from_section, to: seg.to_section!, type: 'segment', path, segment: seg })
            }
          }
        }
      }

      // Générer chaque lot dans l'ordre
      // P2.2 — buildAllocationSummary calculé une seule fois après assignation complète
      const allocationSummary = buildAllocationSummary()

      // ── PHASE SQUELETTE (passe 1 : structure globale avant enrichissement) ──
      if (twoPass) {
        const segmentSkeletons = new Map<string, any[]>() // clé: `${pathId}:${from}-${to}`

        // Générer jonctions (standard) et squelettes de segments
        for (const batch of orderedBatches) {
          if (batch.type === 'junction') {
            const j = batch.junction!
            const chunks = Math.ceil(j.sections_count / BATCH_SIZE)
            const divergenceTargets = assignedPaths
              .map(p => { const seg = p.segments.find(s => s.from_junction === j.id); return seg?.from_section ? { pathId: p.id, pathLabel: p.label, firstSection: seg.from_section } : null })
              .filter(Boolean) as Array<{ pathId: string; pathLabel: string; firstSection: number }>
            for (let c = 0; c < chunks; c++) {
              const from = j.from_section! + c * BATCH_SIZE
              const to = Math.min(from + BATCH_SIZE - 1, j.to_section!)
              const resolvedJSynopsis2p =
                (j.id === 'start' ? book.path_synopses?.trunk_start : undefined) ||
                (j.id === 'end'   ? book.path_synopses?.trunk_end   : undefined) ||
                j.synopsis
              await generateBatch(from, to, to === totalSections, undefined, {
                type: 'junction', junctionName: j.name, junctionSynopsis: resolvedJSynopsis2p,
                convergingPaths: j.paths, divergenceTargets: divergenceTargets.length > 0 ? divergenceTargets : undefined, allocationSummary,
              }, c === 0 && j !== orderedBatches.find(b => b.type === 'junction')?.junction)
            }
          } else {
            const path = batch.path!
            const seg = batch.segment!
            const isLastSeg = seg.to_section === totalSections
            const skelBatchIdx = ++batchIndex
            send({ type: 'batch', batch: skelBatchIdx, from: seg.from_section!, to: seg.to_section!, label: `Squelette §${seg.from_section}–§${seg.to_section} [${path.id}]…` })
            const fromJ = junctionByName.get(seg.from_junction)
            const toJ = junctionByName.get(seg.to_junction)
            const skeletonRaw = await generateText('opus', system,
              buildSkeletonPrompt(bookParams, npcNames, seg.from_section!, seg.to_section!, totalSections, {
                type: 'path_segment', pathId: path.id, pathLabel: path.label,
                segmentSynopsis: book.path_synopses?.paths?.[path.id] || seg.synopsis,
                segmentFrom: seg.from_section, segmentTo: seg.to_section, toJunctionFrom: toJ?.from_section,
                fromJunctionName: fromJ?.name ?? seg.from_junction,
                fromJunctionSections: fromJ?.from_section ? `§${fromJ.from_section}-§${fromJ.to_section}` : '',
                toJunctionName: toJ?.name ?? seg.to_junction,
                toJunctionSections: toJ?.from_section ? `§${toJ.from_section}-§${toJ.to_section}` : '',
                allocationSummary,
              }, { ...endingsCount }, isLastSeg),
              16000)
            let skeletonSections: any[] = []
            try {
              const parsed = JSON.parse(extractJson(skeletonRaw))
              skeletonSections = Array.isArray(parsed.sections) ? parsed.sections : []
            } catch { throw new Error(`JSON squelette invalide §${seg.from_section}–§${seg.to_section}`) }
            if (skeletonSections.length === 0) throw new Error(`Squelette §${seg.from_section}–§${seg.to_section} vide`)
            if (skeletonSections.length < seg.sections_count)
              send({ type: 'warn', message: `⚠ Squelette [${path.id}] §${seg.from_section}–§${seg.to_section} : ${skeletonSections.length}/${seg.sections_count} sections` })
            for (const s of skeletonSections) { if (s.is_ending) { if (s.ending_type === 'victory') endingsCount.victory++; else endingsCount.death++ } }
            segmentSkeletons.set(`${path.id}:${seg.from_section}-${seg.to_section}`, skeletonSections)
            send({ type: 'batch_done', batch: skelBatchIdx, from: seg.from_section!, to: seg.to_section!, count: skeletonSections.length })
          }
        }

        // ── BFS : vérifier que toutes les entrées de chemins sont atteignables ─
        const startJunctionSkel = assignedJunctions[0]
        const pathEntrancesSkel = assignedPaths
          .map(p => { const seg = p.segments.find(s => s.from_junction === startJunctionSkel?.id); return seg?.from_section ? { pathId: p.id, section: seg.from_section } : null })
          .filter(Boolean) as Array<{ pathId: string; section: number }>
        const allSkeletonFlat = [...allRawSections, ...Array.from(segmentSkeletons.values()).flat()]
        let finalUnreachable = pathEntrancesSkel.filter(e => !buildReachability(allSkeletonFlat).has(e.section))
        if (finalUnreachable.length > 0) {
          send({ type: 'warn', message: `⚠ BFS : entrées inaccessibles : ${finalUnreachable.map(e => `§${e.section} (${e.pathId})`).join(', ')} — relance jonction` })
          if (startJunctionSkel?.from_section != null && startJunctionSkel?.to_section != null) {
            const sFrom = startJunctionSkel.from_section, sTo = startJunctionSkel.to_section
            allRawSections.splice(0, allRawSections.length, ...allRawSections.filter(s => s.number < sFrom || s.number > sTo))
            const corrMsg = `CRITIQUE : la jonction §${sFrom}-§${sTo} DOIT avoir des choix vers : ${pathEntrancesSkel.map(e => `§${e.section} (${e.pathId})`).join(', ')}`
            previousSummaries = []
            const rChunks = Math.ceil(startJunctionSkel.sections_count / BATCH_SIZE)
            for (let c = 0; c < rChunks; c++) {
              const from = sFrom + c * BATCH_SIZE, to = Math.min(from + BATCH_SIZE - 1, sTo)
              await generateBatch(from, to, to === totalSections, undefined, {
                type: 'junction', junctionName: startJunctionSkel.name, junctionSynopsis: startJunctionSkel.synopsis,
                convergingPaths: startJunctionSkel.paths,
                divergenceTargets: pathEntrancesSkel.map(e => { const fp = assignedPaths.find(ap => ap.id === e.pathId); return { pathId: e.pathId, pathLabel: fp?.label ?? e.pathId, firstSection: e.section } }),
                allocationSummary,
              }, c === 0, corrMsg)
            }
            // Re-valider après la relance
            const allSkeletonFlat2 = [...allRawSections, ...Array.from(segmentSkeletons.values()).flat()]
            finalUnreachable = pathEntrancesSkel.filter(e => !buildReachability(allSkeletonFlat2).has(e.section))
            if (finalUnreachable.length > 0)
              send({ type: 'warn', message: `⚠ Après relance : encore inaccessible(s) : ${finalUnreachable.map(e => `§${e.section} (${e.pathId})`).join(', ')}` })
            else
              send({ type: 'warn', message: `✓ Toutes les entrées sont accessibles après relance` })
          }
        }

        // ── Validation narrative LLM ──────────────────────────────────────────
        let narrativeReport: any = { paths: [], global_verdict: 'INCONNU', report: 'Validation non effectuée' }
        try {
          const jSummaries = allRawSections.slice(0, 30).map((s: any) => `§${s.number}: ${(s.summary ?? '').slice(0, 80)}`).join('\n')
          const pathSummaryBlocks = Array.from(segmentSkeletons.entries()).map(([key, secs]) => {
            const [pathId] = key.split(':')
            const lines = secs.map((s: any) => `§${s.number}: ${(s.summary ?? '').slice(0, 80)}`).join('\n')
            return `CHEMIN ${pathId} :\n${lines}`
          }).join('\n\n')
          const prompt = `Livre LDVELH à chemins parallèles : "${book.title}" (${book.theme}).\nAnalyse si les chemins narratifs sont DISTINCTS et COHÉRENTS.\n\nJONCTION DE DÉPART :\n${jSummaries}\n\n${pathSummaryBlocks}\n\nRéponds UNIQUEMENT en JSON :\n{"paths":[{"id":"PATH_A","verdict":"OK","issues":[]}],"global_verdict":"OK","report":"Synthèse."}\nVerdicts : "OK" (distincts), "ATTENTION" (doublons partiels), "PROBLÈME" (identiques/incohérents).`
          const msg = await anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 2048, messages: [{ role: 'user', content: prompt }] })
          const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
          narrativeReport = JSON.parse(extractJson(raw))
        } catch (e: any) {
          narrativeReport = { paths: [], global_verdict: 'ERREUR', report: `Validation narrative échouée : ${e?.message}` }
        }

        // ── Sauvegarder le cache squelette ────────────────────────────────────
        // NPCs et objets sont générés dans la passe enrichissement — pas dans le cache
        const cacheData = {
          junctionSections: allRawSections,
          segments: orderedBatches.filter(b => b.type === 'segment').map(b => ({
            pathId: b.path!.id, pathLabel: b.path!.label,
            from: b.segment!.from_section, to: b.segment!.to_section,
            skeleton: segmentSkeletons.get(`${b.path!.id}:${b.segment!.from_section}-${b.segment!.to_section}`) ?? [],
          })),
          pathEntrances: pathEntrancesSkel,
        }
        await supabaseAdmin.from('books').update({ skeleton_cache: cacheData }).eq('id', id)

        // ── Envoyer le rapport et terminer la passe squelette ─────────────────
        const totalSkeletonSections = allRawSections.length + Array.from(segmentSkeletons.values()).reduce((s, a) => s + a.length, 0)
        send({ type: 'skeleton_report', bfs: { ok: finalUnreachable.length === 0, unreachable: finalUnreachable.map(e => `§${e.section} (${e.pathId})`) }, narrative: narrativeReport, sections_count: totalSkeletonSections, paths_count: assignedPaths.length })
        send({ type: 'done', result: { skeleton_cached: true, sections_count: totalSkeletonSections, paths_count: assignedPaths.length } })
        return
      }

      let previousBatchKey = ''  // P2.3 — détecter le changement de chemin

      for (const batch of orderedBatches) {
        if (batch.type === 'junction') {
          const j = batch.junction!
          const batchKey = `junction:${j.id}`
          const resetCtx = batchKey !== previousBatchKey && previousBatchKey !== ''
          previousBatchKey = batchKey

          // Calculer les points d'entrée des chemins qui partent de cette jonction
          const divergenceTargets = assignedPaths
            .map(p => {
              const seg = p.segments.find(s => s.from_junction === j.id)
              if (!seg?.from_section) return null
              return { pathId: p.id, pathLabel: p.label, firstSection: seg.from_section }
            })
            .filter(Boolean) as Array<{ pathId: string; pathLabel: string; firstSection: number }>

          const chunks = Math.ceil(j.sections_count / BATCH_SIZE)
          for (let c = 0; c < chunks; c++) {
            const from = j.from_section! + c * BATCH_SIZE
            const to = Math.min(from + BATCH_SIZE - 1, j.to_section!)
            const isLast = to === totalSections
            const resolvedJunctionSynopsis =
              (j.id === 'start' ? book.path_synopses?.trunk_start : undefined) ||
              (j.id === 'end'   ? book.path_synopses?.trunk_end   : undefined) ||
              j.synopsis
            await generateBatch(from, to, isLast, undefined, {
              type: 'junction',
              junctionName: j.name,
              junctionSynopsis: resolvedJunctionSynopsis,
              convergingPaths: j.paths,
              divergenceTargets: divergenceTargets.length > 0 ? divergenceTargets : undefined,
              allocationSummary,
            }, c === 0 && resetCtx)  // reset seulement au premier chunk d'un nouveau contexte
          }
        } else {
          const path = batch.path!
          const seg = batch.segment!
          const batchKey = `path:${path.id}:${seg.from_junction}-${seg.to_junction}`
          const resetCtx = batchKey !== previousBatchKey
          previousBatchKey = batchKey
          const toJunction = junctionByName.get(seg.to_junction)
          const fromJunction = junctionByName.get(seg.from_junction)
          const segPathCtx = {
            type: 'path_segment' as const,
            pathId: path.id,
            pathLabel: path.label,
            segmentSynopsis: book.path_synopses?.paths?.[path.id] || seg.synopsis,
            segmentFrom: seg.from_section,
            segmentTo: seg.to_section,
            toJunctionFrom: toJunction?.from_section,
            fromJunctionName: fromJunction?.name ?? seg.from_junction,
            fromJunctionSections: fromJunction?.from_section ? `§${fromJunction.from_section}-§${fromJunction.to_section}` : '',
            toJunctionName: toJunction?.name ?? seg.to_junction,
            toJunctionSections: toJunction?.from_section ? `§${toJunction.from_section}-§${toJunction.to_section}` : '',
            allocationSummary,
          }

          // ── Mode standard : lots de 30 ──────────────────────────────────────
          const chunks = Math.ceil(seg.sections_count / BATCH_SIZE)
          for (let c = 0; c < chunks; c++) {
            const from = seg.from_section! + c * BATCH_SIZE
            const to = Math.min(from + BATCH_SIZE - 1, seg.to_section!)
            const isLast = to === totalSections
            await generateBatch(from, to, isLast, undefined, segPathCtx, c === 0 && resetCtx)
          }
        }
      }

      // ── Validation d'accessibilité BFS ──────────────────────────────────────
      // Vérifier que toutes les entrées de chemins sont atteignables depuis §1
      const reachable = buildReachability(allRawSections)
      const startJunction = assignedJunctions[0]
      const pathEntrances = assignedPaths
        .map(p => {
          const firstSeg = p.segments.find(s => s.from_junction === startJunction?.id)
          return firstSeg?.from_section ? { pathId: p.id, section: firstSeg.from_section } : null
        })
        .filter(Boolean) as Array<{ pathId: string; section: number }>

      const unreachable = pathEntrances.filter(e => !reachable.has(e.section))

      if (unreachable.length > 0) {
        const unreachableList = unreachable.map(e => `§${e.section} (${e.pathId})`).join(', ')
        send({ type: 'warn', message: `⚠ Entrées de chemin inaccessibles : ${unreachableList} — relance de la jonction de départ` })

        // Supprimer les sections de la jonction de départ d'allRawSections
        if (startJunction?.from_section != null && startJunction?.to_section != null) {
          const startFrom = startJunction.from_section
          const startTo = startJunction.to_section
          const removed = allRawSections.filter(s => s.number >= startFrom && s.number <= startTo).length
          allRawSections.splice(0, allRawSections.length, ...allRawSections.filter(s => s.number < startFrom || s.number > startTo))

          // Construire le message de corrections obligatoires
          const entrancesStr = pathEntrances.map(e => `§${e.section} pour ${e.pathId}`).join(', ')
          const correctionsMsg = `CRITIQUE : la jonction §${startFrom}-§${startTo} DOIT avoir des choix qui pointent vers TOUTES les entrées de chemins : ${entrancesStr}. Aucun chemin ne peut être omis.`

          send({ type: 'warn', message: `↻ Régénération jonction §${startFrom}-§${startTo} (${removed} sections supprimées) avec corrections obligatoires` })
          previousSummaries = []
          const historyLengthBeforeRetry = condensedBatchHistory.length

          // Régénérer la jonction de départ avec les corrections
          const chunks = Math.ceil(startJunction.sections_count / BATCH_SIZE)
          for (let c = 0; c < chunks; c++) {
            const from = startFrom + c * BATCH_SIZE
            const to = Math.min(from + BATCH_SIZE - 1, startTo)
            const isLast = to === totalSections
            await generateBatch(from, to, isLast, undefined, {
              type: 'junction',
              junctionName: startJunction.name,
              junctionSynopsis: startJunction.synopsis,
              convergingPaths: startJunction.paths,
              divergenceTargets: pathEntrances.map(e => {
                const foundPath = assignedPaths.find(ap => ap.id === e.pathId)
                return { pathId: e.pathId, pathLabel: foundPath?.label ?? e.pathId, firstSection: e.section }
              }),
              allocationSummary,
            }, c === 0, correctionsMsg)
          }

          // Supprimer les entrées de condensedBatchHistory ajoutées pendant la relance (doublon inutile)
          condensedBatchHistory.splice(historyLengthBeforeRetry)

          // Revalider
          const reachable2 = buildReachability(allRawSections)
          const stillUnreachable = pathEntrances.filter(e => !reachable2.has(e.section))
          if (stillUnreachable.length > 0) {
            send({ type: 'warn', message: `⚠ Après relance, entrées toujours inaccessibles : ${stillUnreachable.map(e => `§${e.section} (${e.pathId})`).join(', ')} — vérification manuelle recommandée` })
          } else {
            send({ type: 'step', step: 2, label: '✓ Toutes les entrées de chemins sont accessibles après relance' })
          }
        }
      } else {
        send({ type: 'step', step: 2, label: `✓ Accessibilité validée : toutes les entrées de chemins sont atteignables depuis §1` })
      }
    } else {
      // ── Génération linéaire (livres sans chemins parallèles) ────────────────
      for (let from = 1; from <= totalSections; from += BATCH_SIZE) {
        const to = Math.min(from + BATCH_SIZE - 1, totalSections)
        const isLastBatch = to === totalSections
        const currentAct = acts?.find(a => from >= a.from_section && from <= a.to_section)
        const actInfo = currentAct ? {
          title:     currentAct.title,
          synopsis:  currentAct.synopsis,
          actNumber: acts!.indexOf(currentAct) + 1,
        } : undefined
        await generateBatch(from, to, isLastBatch, actInfo)
      }
    }

    // ── sectionMap déjà alimenté batch par batch ──────────────────────────────

    // ── Insertion des choix ────────────────────────────────────────────────────
    const choicesToInsert: any[] = []
    for (const s of allRawSections) {
      const sectionId = sectionMap.get(s.number)
      if (!sectionId || !s.choices?.length) continue
      for (const c of s.choices) {
        // Accepter target_section ou target comme clé (le LLM utilise parfois les deux)
        const targetNum = c.target_section ?? c.target
        const targetId = sectionMap.get(targetNum) ?? null
        if (!targetId) continue  // ignorer les choix sans cible valide (évite contrainte NOT NULL)
        choicesToInsert.push({
          section_id:        sectionId,
          label:             c.label,
          locked_label:      c.locked_label ?? null,
          archetype:         c.archetype ?? null,
          target_section_id: targetId,
          requires_trial:    false,
          condition:         c.condition ?? null,
          sort_order:        c.sort_order ?? 0,
          is_back:           c.is_back ?? false,
        })
      }
    }
    if (choicesToInsert.length > 0) {
      const { error: choicesError } = await supabaseAdmin.from('choices').insert(choicesToInsert)
      if (choicesError) {
        console.error('[generate-sections] choices insert error:', choicesError)
        send({ type: 'warn', message: `⚠ Insertion choix échouée : ${choicesError.message}` })
      }
    } else {
      send({ type: 'warn', message: `⚠ Aucun choix valide généré (${allRawSections.filter(s => s.choices?.length).length} sections avaient des choices, mais sans target_section valide)` })
    }

    // ── Résolution des trials ──────────────────────────────────────────────────
    for (const s of allRawSections) {
      if (!s.trial) continue
      const sectionId = sectionMap.get(s.number)
      if (!sectionId) continue
      const rawTrial = s.trial

      // Appliquer l'assignation combat si disponible pour cette section
      if (rawTrial.type === 'combat') {
        const assignment = combatAssignments.get(s.number)
        if (assignment) {
          const assignedNpc = npcNameMap.get(assignment.npc_name.toLowerCase())
          rawTrial.npc_id = assignment.npc_id
          rawTrial.enemy_weapon_type = assignment.enemy_weapon_type
          rawTrial.enemy_name = assignment.npc_name
          if (assignedNpc) {
            rawTrial.enemy = { name: assignment.npc_name, force: assignedNpc.force ?? 5, endurance: assignedNpc.endurance ?? 10 }
          }
        }
      }

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

      // Résolution du format multi-adversaires (enemies[]) ou legacy (enemy_name)
      if (rawTrial.type === 'combat') {
        if (Array.isArray(rawTrial.enemies) && rawTrial.enemies.length > 0) {
          // Format N vs N : résoudre chaque ennemi depuis npcNameMap
          trial.enemies = rawTrial.enemies.map((e: any) => {
            const npc = npcNameMap.get((e.npc_name ?? '').toLowerCase())
            return {
              npc_id: npc?.id ?? null,
              npc_name: e.npc_name,
              force: e.force ?? npc?.force ?? 5,
              endurance: e.endurance ?? npc?.endurance ?? 10,
              enemy_weapon_type: e.enemy_weapon_type ?? npc?.weapon_type ?? null,
            }
          })
          // Compatibilité rétrograde : premier ennemi = enemy principal
          const first = trial.enemies[0]
          trial.npc_id = first.npc_id
          trial.enemy = { name: first.npc_name, force: first.force, endurance: first.endurance }
          trial.enemy_weapon_type = first.enemy_weapon_type ?? rawTrial.enemy_weapon_type ?? null
        } else {
          // Format legacy : enemy_name unique
          const npcData = rawTrial.enemy_name ? npcNameMap.get(rawTrial.enemy_name.toLowerCase()) : null
          if (npcData) {
            trial.npc_id = rawTrial.npc_id ?? npcData.id
            trial.enemy = rawTrial.enemy ?? { name: rawTrial.enemy_name, force: npcData.force, endurance: npcData.endurance }
          }
          if (rawTrial.enemy_weapon_type) trial.enemy_weapon_type = rawTrial.enemy_weapon_type
        }
      }

      await supabaseAdmin.from('sections').update({ trial }).eq('id', sectionId)

      if (rawTrial.combat_type_id && combatTypesList.some((ct: any) => ct.id === rawTrial.combat_type_id)) {
        await supabaseAdmin.from('sections').update({ combat_type_id: rawTrial.combat_type_id }).eq('id', sectionId)
      }
    }

    // ── Résolution des sections_used / use_section_ids sur les items ──────────
    for (const rawItem of rawItemsData) {
      const sections_used = rawItem.pickup_section_numbers
        .map((n: number) => sectionMap.get(n)).filter(Boolean) as string[]
      const use_section_ids = rawItem.use_section_numbers
        .map((n: number) => sectionMap.get(n)).filter(Boolean) as string[]
      if (sections_used.length > 0 || use_section_ids.length > 0) {
        await supabaseAdmin.from('items').update({ sections_used, use_section_ids }).eq('id', rawItem.id)
      }
    }

    const actualSectionCount = sectionMap.size
    await supabaseAdmin.from('books').update({ phase: 'structure_generated', num_sections: actualSectionCount }).eq('id', id)

    send({ type: 'step_done', step: 2, detail: `${actualSectionCount} section(s) insérée(s)` })

    // ── ÉTAPE 3 : Assignation automatique des compagnons ──────────────────────
    send({ type: 'step', step: 3, label: 'Assignation des compagnons…' })
    let companions_assigned = 0
    let companions_error: string | null = null
    try {
      const companionNpcs = (npcStructure.npcs ?? [])
        .map((n: any) => ({ name: n.name, type: n.type }))
        .filter((n: any) => n.type === 'allié' || n.type === 'neutre')

      if (companionNpcs.length === 0) {
        send({ type: 'warn', message: '⚠ Compagnons : aucun PNJ de type allié/neutre trouvé — assignation ignorée' })
      } else {
        const synopsis = book.synopsis?.trim() || book.book_summary?.trim() || book.theme
        const companionLines = companionNpcs.map((n: any) => `- ${n.name} (${n.type})`).join('\n')

        // Construire map name → npc_id depuis les NPCs insérés
        const { data: insertedCompanions } = await supabaseAdmin
          .from('npcs').select('id, name, type')
          .eq('book_id', id).in('type', ['allié', 'neutre'])
        const companionIdByName = new Map(
          (insertedCompanions ?? []).map((n: any) => [n.name.toLowerCase(), n.id])
        )

        if (companionIdByName.size === 0) {
          send({ type: 'warn', message: '⚠ Compagnons : PNJ alliés/neutres introuvables en base — vérifier l\'insertion des NPCs' })
        } else {
          // Traiter par lots de 30 pour éviter la troncature Haiku (max 8192 tokens)
          const COMPANION_BATCH = 30
          for (let i = 0; i < allRawSections.length; i += COMPANION_BATCH) {
            const batchSections = allRawSections.slice(i, i + COMPANION_BATCH)
            const batchNumbers = new Set(batchSections.map((s: any) => s.number))
            // Contexte cumulatif : résumés précédents pour détecter les morts/départs
            const previousContext = allRawSections
              .slice(0, i)
              .map((s: any) => `§${s.number}: ${s.summary ?? ''}`)
              .slice(-20)  // 20 dernières sections max pour contexte
              .join('\n')
            const sectionLines = batchSections
              .map((s: any) => {
                const isCombat = s.trial?.type === 'combat'
                const isEnding = s.is_ending
                // Utiliser des marqueurs sans crochets pour ne pas perturber extractJson
                const tag = isCombat ? ' (COMBAT)' : isEnding ? ' (FIN)' : ''
                return `§${s.number}${tag}: ${s.summary ?? '(sans résumé)'}`
              })
              .join('\n')
            try {
              const msg = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 8192,
                messages: [{
                  role: 'user',
                  content: `Tu es l'auteur d'un livre "Dont Vous Êtes le Héros" : "${book.title}"\n\nSynopsis :\n${synopsis}\n\nAlliés du protagoniste :\n${companionLines}\n\nRÈGLE : Les alliés accompagnent le protagoniste par défaut dans les sections de narration. Ils sont ABSENTS uniquement si :\n- Le résumé de la section indique explicitement qu'ils sont morts, partis, capturés, ou que c'est une scène solo\n- La section est marquée (COMBAT) — les alliés ne participent pas aux combats du protagoniste\n- La section est marquée (FIN)\n- Le contexte précédent montre clairement qu'ils ont quitté l'histoire\n\n${previousContext ? `Contexte des sections précédentes (pour détecter morts/départs d'alliés) :\n${previousContext}\n\n` : ''}Sections à traiter (lot ${Math.floor(i / COMPANION_BATCH) + 1}) :\n${sectionLines}\n\nRéponds UNIQUEMENT avec le JSON brut, sans texte avant ni après (TOUTES les sections, même celles avec companions:[]) : [{"number":1,"companions":["Nom1"]},{"number":2,"companions":[]},...]`,
                }],
              })
              const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
              const assignments: { number: number; companions: string[] }[] = JSON.parse(extractJson(raw))
              for (const a of assignments) {
                if (!batchNumbers.has(a.number)) continue  // ignorer sections hors lot
                const sectionId = sectionMap.get(a.number)
                if (!sectionId || !a.companions?.length) continue
                const ids = a.companions
                  .map((name: string) => companionIdByName.get(name.toLowerCase()))
                  .filter(Boolean) as string[]
                if (!ids.length) continue
                const { error: updateErr } = await supabaseAdmin.from('sections').update({ companion_npc_ids: ids }).eq('id', sectionId)
                if (updateErr) send({ type: 'warn', message: `⚠ Compagnon §${a.number} update échoué : ${updateErr.message}` })
                else companions_assigned += ids.length
              }
            } catch (batchErr: any) {
              send({ type: 'warn', message: `⚠ Compagnons lot ${Math.floor(i / COMPANION_BATCH) + 1} échoué : ${batchErr?.message ?? 'erreur inconnue'}` })
            }
          }
        }
      }
    } catch (companionErr: any) {
      companions_error = companionErr?.message ?? 'Erreur inconnue'
    }

    send({ type: 'step_done', step: 3, detail: `${companions_assigned} assignation(s)${companions_error ? ' ⚠ ' + companions_error : ''}` })

    // ── ÉTAPE 4 : Passe de validation et réparation automatique ───────────────
    send({ type: 'step', step: 4, label: 'Auto-réparation…' })
    let validation: { fixed: number; remaining_critical: number; log: string[] } = { fixed: 0, remaining_critical: 0, log: [] }
    try {
      validation = await runAutoRepair(id, npcNameMap, totalSections)
    } catch (valErr: any) {
      validation.log.push(`⚠ Validation échouée : ${valErr.message}`)
    }

    send({ type: 'step_done', step: 4, detail: `${validation.fixed} correction(s) · ${validation.remaining_critical} critique(s) restant(s)`, log: validation.log })

    // ── ÉTAPE 5 : Génération des textes de retour de section ──────────────────
    send({ type: 'step', step: 5, label: 'Textes de transition…' })
    let transitions_generated = 0
    try {
      const summaryById = new Map<string, string>()
      for (const s of allRawSections) { const sid = sectionMap.get(s.number); if (sid) summaryById.set(sid, s.summary ?? '') }
      // Recharger les choix après réparation (de nouvelles cibles ont pu être assignées)
      const allSectionIds = Array.from(sectionMap.values())
      const { data: allChoices } = await supabaseAdmin
        .from('choices')
        .select('id, section_id, target_section_id, label')
        .in('section_id', allSectionIds)

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

    send({ type: 'step_done', step: 5, detail: `${transitions_generated} transition(s)` })

    send({ type: 'done', result: {
      sections_count:      actualSectionCount,
      sections_target:     totalSections,
      npcs_count:          npcStructure.npcs?.length ?? 0,
      items_count,
      choices_count:       choicesToInsert.length,
      acts_count:          acts?.length ?? 0,
      companions_assigned,
      companions_error,
      transitions_generated,
      validation,
    }})
      } catch (err: any) {
        console.error('[generate-sections]', err)
        send({ type: 'error', error: err.message })
      } finally {
        controller.close()
      }
    }
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
