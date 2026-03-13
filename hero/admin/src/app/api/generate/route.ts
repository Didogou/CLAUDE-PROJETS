import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildBookStructurePrompt } from '@/lib/prompts'
import type { GenerateBookParams } from '@/types'

export const maxDuration = 300 // 5 minutes

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * Corrige les caractères de contrôle littéraux écrits par Claude à l'intérieur
 * des chaînes JSON (ex: vrai \n, \t, \r au lieu des séquences d'échappement \n \t \r).
 */
function fixJsonControlChars(raw: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { result += ch; escaped = false; continue }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString) {
      if      (ch === '\n') { result += '\\n';  continue }
      else if (ch === '\r') { result += '\\r';  continue }
      else if (ch === '\t') { result += '\\t';  continue }
      else if (ch.charCodeAt(0) < 0x20) { continue } // autres ctrl chars → supprimés
    }
    result += ch
  }
  return result
}

async function streamMessageWithRetry(params: Parameters<typeof anthropic.messages.stream>[0], maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const stream = anthropic.messages.stream(params)
      return await stream.finalMessage()
    } catch (err: any) {
      const isOverloaded = err?.status === 529 || err?.error?.type === 'overloaded_error'
      if (isOverloaded && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 30000)))
        continue
      }
      throw err
    }
  }
  throw new Error('Max retries reached')
}

export async function POST(req: NextRequest) {
  try {
    const params: GenerateBookParams = await req.json()

    // 1. Créer le livre en BDD (statut draft)
    const { data: book, error: bookError } = await supabaseAdmin
      .from('books')
      .insert({
        title: params.title, theme: params.theme, age_range: params.age_range,
        context_type: params.context_type, language: params.language,
        difficulty: params.difficulty, content_mix: params.content_mix,
        description: params.description, map_type: params.map_type ?? 'none', status: 'draft',
      })
      .select().single()
    if (bookError) throw bookError

    // 2. Générer la structure via Claude (streaming pour éviter le timeout SDK)
    const message = await streamMessageWithRetry({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      system: 'Tu es un générateur de JSON. Ta réponse entière doit être du JSON brut valide. Commence par { et termine par }. N\'inclus aucun texte, commentaire ou bloc markdown. Dans les chaînes JSON, échappe correctement les guillemets (\\") et les retours à la ligne (\\n).',
      messages: [{ role: 'user', content: buildBookStructurePrompt(params) }],
    })

    const rawContent = message.content[0].type === 'text' ? message.content[0].text : ''
    let structure: { npcs?: any[]; sections: any[]; locations?: any[] }
    try {
      // 1. Nettoyer les balises markdown éventuelles
      let cleaned = rawContent.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim()
      // 2. Extraire le bloc { … } si du texte précède
      if (!cleaned.startsWith('{')) {
        const start = rawContent.indexOf('{')
        const end   = rawContent.lastIndexOf('}')
        if (start !== -1 && end !== -1) cleaned = rawContent.slice(start, end + 1)
      }
      // 3. Sanitiser les caractères de contrôle littéraux dans les strings JSON
      //    (Claude écrit parfois de vrais \n/\t dans les valeurs de chaîne)
      cleaned = fixJsonControlChars(cleaned)
      structure = JSON.parse(cleaned)
    } catch {
      const preview = rawContent.slice(0, 500).replace(/\n/g, '↵')
      throw new Error(`Claude a retourné un JSON invalide. Début de la réponse : ${preview}`)
    }

    // 3. Insérer les lieux et construire un index nom → location id
    const locationNameMap = new Map<string, string>() // name → id

    if (structure.locations?.length && params.map_type !== 'none') {
      const locToInsert = structure.locations.map((l: any) => ({
        book_id: book.id,
        name:    l.name,
        x:       Math.min(100, Math.max(0, l.x ?? 50)),
        y:       Math.min(100, Math.max(0, l.y ?? 50)),
        icon:    l.icon ?? '📍',
      }))
      const { data: insertedLocs, error: locError } = await supabaseAdmin
        .from('locations').insert(locToInsert).select()
      if (locError) throw locError
      for (const loc of insertedLocs) {
        locationNameMap.set(loc.name.toLowerCase(), loc.id)
      }
    }

    // 4. Insérer les PNJ et construire un index nom → PNJ inséré
    // Un PNJ peut apparaître dans plusieurs sections
    const npcNameMap = new Map<string, { id: string; force: number; agilite: number; endurance: number }>()

    if (structure.npcs?.length) {
      const npcsToInsert = structure.npcs.map((n: any) => ({
        book_id: book.id,
        name:            n.name,
        type:            ['ennemi', 'boss', 'allié', 'neutre', 'marchand'].includes(n.type) ? n.type : 'ennemi',
        description:     n.description ?? null,
        force:           n.force       ?? 5,
        agilite:         n.agilite     ?? 5,
        intelligence:    n.intelligence ?? 5,
        magie:           n.magie        ?? 0,
        endurance:       n.endurance    ?? 10,
        chance:          n.chance       ?? 5,
        special_ability: n.special_ability ?? null,
        resistances:     n.resistances     ?? null,
        loot:            n.loot            ?? null,
        speech_style:    n.speech_style    ?? null,
        dialogue_intro:  n.dialogue_intro  ?? null,
      }))

      const { data: insertedNpcs, error: npcError } = await supabaseAdmin
        .from('npcs').insert(npcsToInsert).select()
      if (npcError) throw npcError

      for (const npc of insertedNpcs) {
        npcNameMap.set(npc.name.toLowerCase(), {
          id: npc.id, force: npc.force, agilite: npc.agilite, endurance: npc.endurance,
        })
      }
    }

    // 5. Insérer les sections (sans les trials d'abord — les UUIDs ne sont pas encore connus)
    const sectionsToInsert = structure.sections.map((s: any) => ({
      book_id:     book.id,
      number:      s.number,
      summary:     s.summary     ?? null,
      content:     s.content,
      is_ending:   s.is_ending   ?? false,
      ending_type: s.ending_type ?? null,
      trial:       null,
      location_id: s.location_name ? (locationNameMap.get(s.location_name.toLowerCase()) ?? null) : null,
    }))

    const { data: insertedSections, error: sectionsError } = await supabaseAdmin
      .from('sections').insert(sectionsToInsert).select()
    if (sectionsError) throw sectionsError

    const sectionMap = new Map<number, string>(insertedSections.map((s: any) => [s.number, s.id]))

    // 6. Insérer les choix
    const choicesToInsert: any[] = []
    for (const s of structure.sections) {
      const sectionId = sectionMap.get(s.number)
      if (!sectionId || !s.choices?.length) continue
      for (const c of s.choices) {
        choicesToInsert.push({
          section_id:        sectionId,
          label:             c.label,
          target_section_id: sectionMap.get(c.target_section) ?? null,
          requires_trial:    false,
          sort_order:        c.sort_order ?? 0,
        })
      }
    }
    if (choicesToInsert.length > 0) {
      const { error: choicesError } = await supabaseAdmin.from('choices').insert(choicesToInsert)
      if (choicesError) throw choicesError
    }

    // 7. Résoudre les trials (section IDs + lien PNJ)
    // Un même PNJ peut être référencé dans plusieurs sections
    for (const s of structure.sections) {
      if (!s.trial) continue
      const sectionId = sectionMap.get(s.number)
      if (!sectionId) continue

      const rawTrial = s.trial
      const npcKey = rawTrial.enemy_name?.toLowerCase()
      const npcData = npcKey ? npcNameMap.get(npcKey) : null

      const trial: Record<string, any> = {
        type:                      rawTrial.type,
        stat:                      rawTrial.stat,
        success_section_id:        sectionMap.get(rawTrial.success_section) ?? null,
        failure_section_id:        sectionMap.get(rawTrial.failure_section) ?? null,
        endurance_loss_on_failure: rawTrial.endurance_loss_on_failure ?? null,
        mana_cost:                 rawTrial.mana_cost ?? null,
        xp_reward:                 rawTrial.xp_reward ?? null,
        item_rewards:              rawTrial.item_rewards ?? null,
        dialogue_opening:          rawTrial.dialogue_opening ?? null,
        dialogue_goal:             rawTrial.dialogue_goal ?? null,
      }

      // Lier au PNJ si trouvé (peut apparaître dans plusieurs sections)
      if (npcData) {
        trial.npc_id = npcData.id
        trial.enemy  = {
          name:      rawTrial.enemy_name,
          force:     npcData.force,
          endurance: npcData.endurance,
        }
      } else if (rawTrial.enemy) {
        trial.enemy = rawTrial.enemy
      }

      await supabaseAdmin.from('sections').update({ trial }).eq('id', sectionId)
    }

    return NextResponse.json({
      book_id:          book.id,
      sections_count:   insertedSections.length,
      npcs_count:       structure.npcs?.length ?? 0,
      locations_count:  structure.locations?.length ?? 0,
    })
  } catch (err: any) {
    console.error(err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
