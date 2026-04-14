import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropic, generateText, extractJson, normalizeEndingType } from '@/lib/ai-utils'
import Anthropic from '@anthropic-ai/sdk'
import { buildSectionBatchPrompt } from '@/lib/prompts'
import type { BookAct } from '@/types'

export const maxDuration = 300

const VALID_TRIAL_TYPES = new Set(['combat', 'agilite', 'intelligence', 'magie', 'chance', 'crochetage', 'dialogue', 'enigme'])

// ── Outils de l'agent ────────────────────────────────────────────────────────

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_structure',
    description: 'Charge la structure complète du livre : sections (numéro, résumé, type d\'épreuve, ennemis, routage) et choix (de→vers). Inclut les problèmes pré-détectés par section. À appeler en premier.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'fix_ending_type',
    description: 'Définit le type de fin d\'une section (victoire ou mort).',
    input_schema: {
      type: 'object',
      properties: {
        section_number: { type: 'number', description: 'Numéro de la section' },
        ending_type: { type: 'string', enum: ['victory', 'death'] },
      },
      required: ['section_number', 'ending_type'],
    },
  },
  {
    name: 'fix_trial_type',
    description: 'Corrige le type d\'épreuve d\'une section (ex: "intel" → "intelligence").',
    input_schema: {
      type: 'object',
      properties: {
        section_number: { type: 'number' },
        trial_type: { type: 'string', enum: ['combat', 'agilite', 'intelligence', 'magie', 'chance', 'crochetage', 'dialogue', 'enigme'] },
      },
      required: ['section_number', 'trial_type'],
    },
  },
  {
    name: 'fix_combat_enemy',
    description: 'Assigne un PNJ ennemi à une section de combat sans ennemi. Utilise npc_id (champ "id" de enemy_npcs dans get_structure) en priorité — c\'est le moyen le plus fiable. npc_name est un fallback si npc_id n\'est pas disponible.',
    input_schema: {
      type: 'object',
      properties: {
        section_number: { type: 'number' },
        npc_id: { type: 'string', description: 'UUID du PNJ (champ "id" de enemy_npcs) — prioritaire sur npc_name' },
        npc_name: { type: 'string', description: 'Nom du PNJ ennemi ou boss — utilisé si npc_id absent' },
      },
      required: ['section_number'],
    },
  },
  {
    name: 'fix_trial_routing',
    description: 'Définit les sections de succès et d\'échec d\'une épreuve. Choisir des sections cohérentes avec la narration.',
    input_schema: {
      type: 'object',
      properties: {
        section_number: { type: 'number' },
        success_section: { type: 'number', description: 'Section où aller en cas de succès' },
        failure_section: { type: 'number', description: 'Section où aller en cas d\'échec' },
      },
      required: ['section_number', 'success_section', 'failure_section'],
    },
  },
  {
    name: 'fix_choice_target',
    description: 'Redirige un choix vers une autre section. Utilise le numéro de section source et l\'index du choix (0 = premier choix, 1 = deuxième, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        from_section: { type: 'number', description: 'Section où se trouve le choix' },
        choice_index: { type: 'number', description: 'Index du choix à modifier (0-basé)' },
        target_section: { type: 'number', description: 'Nouvelle section cible' },
        reason: { type: 'string', description: 'Justification narrative de ce choix' },
      },
      required: ['from_section', 'choice_index', 'target_section', 'reason'],
    },
  },
  {
    name: 'add_choices',
    description: 'Ajoute des choix à une section qui n\'en a pas (cul-de-sac). Créer 2 choix cohérents avec le résumé de la section.',
    input_schema: {
      type: 'object',
      properties: {
        section_number: { type: 'number' },
        choices: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Texte immersif du choix (20-50 mots)' },
              target_section: { type: 'number' },
            },
            required: ['label', 'target_section'],
          },
        },
      },
      required: ['section_number', 'choices'],
    },
  },
  {
    name: 'regenerate_batch',
    description: 'Regénère un lot de sections avec des instructions de correction. À utiliser quand les problèmes structurels ou narratifs sont trop profonds pour être corrigés section par section — par exemple des incohérences dans les embranchements, des transitions narratives cassées, des choix sémantiquement incorrects. Attention : opération lente (~30s par lot de 30 sections).',
    input_schema: {
      type: 'object',
      properties: {
        from_section: { type: 'number', description: 'Première section du lot à regénérer' },
        to_section: { type: 'number', description: 'Dernière section du lot (max 30 sections d\'écart)' },
        corrections: {
          type: 'string',
          description: 'Instructions précises à intégrer dans la regénération. Ex: "§30 ne doit pas renvoyer à §13 (retour en arrière narratif) mais vers §31. §26 est un cul-de-sac, ajouter 2 choix vers §27 et §29. Éviter les combats consécutifs entre §40 et §45."',
        },
      },
      required: ['from_section', 'to_section', 'corrections'],
    },
  },
  {
    name: 'report_done',
    description: 'Signale que la correction est terminée. Fournir un bilan complet des corrections.',
    input_schema: {
      type: 'object',
      properties: {
        corrections_made: { type: 'number', description: 'Nombre total de corrections' },
        summary: { type: 'string', description: 'Résumé des corrections apportées par catégorie' },
        remaining_issues: { type: 'string', description: 'Problèmes non résolus (ou "Aucun")' },
      },
      required: ['corrections_made', 'summary', 'remaining_issues'],
    },
  },
]

// ── Exécution des outils ─────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, any>, bookId: string): Promise<any> {
  switch (name) {
    case 'get_structure': {
      const { data: sections } = await supabaseAdmin
        .from('sections').select('id, number, summary, is_ending, ending_type, trial')
        .eq('book_id', bookId).order('number')
      const sectionIds = (sections ?? []).map((s: any) => s.id)
      const { data: choices } = await supabaseAdmin
        .from('choices').select('id, section_id, target_section_id, label, sort_order')
        .in('section_id', sectionIds).order('sort_order')
      const { data: npcs } = await supabaseAdmin
        .from('npcs').select('id, name, type, force, endurance')
        .eq('book_id', bookId).in('type', ['ennemi', 'boss'])

      const sectionById = new Map((sections ?? []).map((s: any) => [s.id, s]))
      const choicesBySection = new Map<string, any[]>()
      for (const c of choices ?? []) {
        if (!choicesBySection.has(c.section_id)) choicesBySection.set(c.section_id, [])
        choicesBySection.get(c.section_id)!.push(c)
      }

      const structuredSections = (sections ?? []).map((s: any) => {
        const t = s.trial as any
        const sChoices = (choicesBySection.get(s.id) ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order)
        const issues: string[] = []

        if (!s.is_ending) {
          const hasChoices = sChoices.length > 0
          const hasTrialRouting = t && (t.success_section_id || t.failure_section_id)
          if (!hasChoices && !hasTrialRouting && !t) issues.push('cul-de-sac: aucun choix')
          if (!hasChoices && !hasTrialRouting && t) issues.push('épreuve sans routage succès/échec')
          if (t && t.success_section_id && !t.failure_section_id) issues.push('épreuve: section échec manquante')
          if (t && !t.success_section_id && t.failure_section_id) issues.push('épreuve: section succès manquante')
        }
        if (t?.type && !VALID_TRIAL_TYPES.has(t.type)) issues.push(`type épreuve invalide: "${t.type}"`)
        if (t?.type === 'combat' && !t?.npc_id && !t?.enemy) issues.push('combat sans ennemi')
        if (s.is_ending && !s.ending_type) issues.push('fin sans type (victoire/mort)')
        for (const c of sChoices) {
          if (c.target_section_id === s.id) issues.push(`choix "${c.label.slice(0, 30)}" boucle sur lui-même`)
          if (!c.target_section_id) issues.push(`choix "${c.label.slice(0, 30)}" sans cible`)
        }
        // Backward links
        for (const c of sChoices) {
          const targetSec = c.target_section_id ? sectionById.get(c.target_section_id) as any : null
          if (targetSec && s.number - targetSec.number > 20) {
            issues.push(`lien en arrière: choix "${c.label.slice(0, 25)}" → §${targetSec.number} (−${s.number - targetSec.number})`)
          }
        }

        return {
          n: s.number,
          summary: (s.summary ?? '').slice(0, 80),
          ending: s.is_ending ? (s.ending_type ?? 'fin-sans-type') : null,
          trial: t ? {
            type: t.type,
            enemy: t.enemy?.name ?? (t.npc_id ? 'PNJ lié' : null),
            succ: t.success_section_id ? (sectionById.get(t.success_section_id) as any)?.number ?? '?' : null,
            fail: t.failure_section_id ? (sectionById.get(t.failure_section_id) as any)?.number ?? '?' : null,
          } : null,
          choices: sChoices.map((c: any, idx: number) => ({
            idx,
            label: c.label.slice(0, 50),
            to: c.target_section_id ? (sectionById.get(c.target_section_id) as any)?.number ?? null : null,
            loop: c.target_section_id === s.id,
          })),
          issues,
        }
      })

      const allIssues = structuredSections.flatMap((s: any) =>
        s.issues.map((i: string) => `§${s.n}: ${i}`)
      )

      return {
        total_sections: sections?.length ?? 0,
        total_choices: choices?.length ?? 0,
        sections: structuredSections,
        enemy_npcs: (npcs ?? []).map((n: any) => ({ id: n.id, name: n.name, display: `${n.name} (${n.type}, F:${n.force} E:${n.endurance})` })),
        issues_summary: allIssues,
        critical_count: allIssues.length,
      }
    }

    case 'fix_ending_type': {
      const { data: sec } = await supabaseAdmin.from('sections').select('id').eq('book_id', bookId).eq('number', input.section_number).single()
      if (!sec) throw new Error(`§${input.section_number} introuvable`)
      await supabaseAdmin.from('sections').update({ ending_type: input.ending_type }).eq('id', sec.id)
      return { ok: true, message: `§${input.section_number} → type "${input.ending_type}"` }
    }

    case 'fix_trial_type': {
      const { data: sec } = await supabaseAdmin.from('sections').select('id, trial').eq('book_id', bookId).eq('number', input.section_number).single()
      if (!sec) throw new Error(`§${input.section_number} introuvable`)
      await supabaseAdmin.from('sections').update({ trial: { ...(sec.trial as object ?? {}), type: input.trial_type } }).eq('id', sec.id)
      return { ok: true, message: `§${input.section_number} → type épreuve "${input.trial_type}"` }
    }

    case 'fix_combat_enemy': {
      const { data: sec } = await supabaseAdmin.from('sections').select('id, trial').eq('book_id', bookId).eq('number', input.section_number).single()
      if (!sec) throw new Error(`§${input.section_number} introuvable`)
      let npc: any = null
      if (input.npc_id) {
        const { data } = await supabaseAdmin.from('npcs').select('id, name, force, endurance').eq('book_id', bookId).eq('id', input.npc_id).maybeSingle()
        npc = data
      }
      if (!npc && input.npc_name) {
        const baseName = input.npc_name.split(/\s*\(/)[0].trim()
        const { data } = await supabaseAdmin.from('npcs').select('id, name, force, endurance').eq('book_id', bookId).ilike('name', `${baseName}%`).limit(1).maybeSingle()
        npc = data
      }
      if (!npc) throw new Error(`PNJ "${input.npc_id ?? input.npc_name ?? 'inconnu'}" introuvable`)
      await supabaseAdmin.from('sections').update({ trial: { ...(sec.trial as object ?? {}), npc_id: npc.id, enemy: { name: npc.name, force: npc.force, endurance: npc.endurance } } }).eq('id', sec.id)
      return { ok: true, message: `§${input.section_number} → ennemi "${npc.name}"` }
    }

    case 'fix_trial_routing': {
      const [{ data: sec }, { data: succSec }, { data: failSec }] = await Promise.all([
        supabaseAdmin.from('sections').select('id, trial').eq('book_id', bookId).eq('number', input.section_number).single(),
        supabaseAdmin.from('sections').select('id').eq('book_id', bookId).eq('number', input.success_section).single(),
        supabaseAdmin.from('sections').select('id').eq('book_id', bookId).eq('number', input.failure_section).single(),
      ])
      if (!sec) throw new Error(`§${input.section_number} introuvable`)
      if (!succSec) throw new Error(`Section succès §${input.success_section} introuvable`)
      if (!failSec) throw new Error(`Section échec §${input.failure_section} introuvable`)
      await supabaseAdmin.from('sections').update({ trial: { ...(sec.trial as object ?? {}), success_section_id: succSec.id, failure_section_id: failSec.id } }).eq('id', sec.id)
      return { ok: true, message: `§${input.section_number} → succès §${input.success_section}, échec §${input.failure_section}` }
    }

    case 'fix_choice_target': {
      const { data: fromSec } = await supabaseAdmin.from('sections').select('id').eq('book_id', bookId).eq('number', input.from_section).single()
      if (!fromSec) throw new Error(`§${input.from_section} introuvable`)
      const { data: choices } = await supabaseAdmin.from('choices').select('id').eq('section_id', fromSec.id).order('sort_order')
      const choice = choices?.[input.choice_index]
      if (!choice) throw new Error(`Choix index ${input.choice_index} introuvable dans §${input.from_section}`)
      const { data: targetSec } = await supabaseAdmin.from('sections').select('id').eq('book_id', bookId).eq('number', input.target_section).single()
      if (!targetSec) throw new Error(`Section cible §${input.target_section} introuvable`)
      await supabaseAdmin.from('choices').update({ target_section_id: targetSec.id }).eq('id', choice.id)
      return { ok: true, message: `§${input.from_section} choix[${input.choice_index}] → §${input.target_section} (${input.reason})` }
    }

    case 'add_choices': {
      const { data: sec } = await supabaseAdmin.from('sections').select('id').eq('book_id', bookId).eq('number', input.section_number).single()
      if (!sec) throw new Error(`§${input.section_number} introuvable`)
      const toInsert = await Promise.all(input.choices.map(async (c: any, i: number) => {
        const { data: targetSec } = await supabaseAdmin.from('sections').select('id').eq('book_id', bookId).eq('number', c.target_section).single()
        if (!targetSec) throw new Error(`Section cible §${c.target_section} introuvable`)
        return { section_id: sec.id, label: c.label, target_section_id: targetSec.id, requires_trial: false, sort_order: i, is_back: false }
      }))
      await supabaseAdmin.from('choices').insert(toInsert)
      return { ok: true, message: `§${input.section_number}: ${input.choices.length} choix ajoutés` }
    }

    case 'regenerate_batch': {
      const { from_section, to_section, corrections } = input
      if (to_section - from_section > 30) throw new Error('Lot trop grand (max 30 sections)')

      // Fetch book data
      const { data: book } = await supabaseAdmin.from('books').select('*').eq('id', bookId).single()
      if (!book) throw new Error('Livre introuvable')

      const bookParams = {
        title: book.title, theme: book.theme,
        synopsis: book.synopsis ?? undefined,
        book_summary: book.synopsis?.trim() || book.book_summary,
        age_range: book.age_range, context_type: book.context_type,
        language: book.language, difficulty: book.difficulty,
        num_sections: book.num_sections ?? 30,
        content_mix: book.content_mix ?? { combat: 20, chance: 10, enigme: 10, magie: 5 },
        map_style: book.map_style ?? null, address_form: book.address_form,
        description: book.description,
      }

      const [{ data: npcs }, { data: locations }, { data: prevSections }, { data: allSections }] = await Promise.all([
        supabaseAdmin.from('npcs').select('id, name, force, agilite, endurance').eq('book_id', bookId),
        supabaseAdmin.from('locations').select('id, name').eq('book_id', bookId),
        supabaseAdmin.from('sections').select('number, summary').eq('book_id', bookId).lt('number', from_section).order('number', { ascending: false }).limit(3),
        supabaseAdmin.from('sections').select('id, number').eq('book_id', bookId),
      ])

      const npcNames = (npcs ?? []).map((n: any) => n.name)
      const locationNames = (locations ?? []).map((l: any) => l.name)
      const npcNameMap = new Map((npcs ?? []).map((n: any) => [n.name.toLowerCase(), n]))
      const locationNameMap = new Map((locations ?? []).map((l: any) => [l.name.toLowerCase(), l.id]))
      const fullSectionMap = new Map((allSections ?? []).map((s: any) => [s.number, s.id]))
      const previousSummaries = ((prevSections ?? []).reverse()).map((s: any) => `§${s.number} : "${s.summary ?? ''}"`)

      const acts: BookAct[] | null = book.acts ?? null
      const currentAct = acts?.find((a: BookAct) => from_section >= a.from_section && from_section <= a.to_section)
      const actInfo = currentAct ? {
        title: currentAct.title, synopsis: currentAct.synopsis,
        actNumber: acts!.indexOf(currentAct) + 1,
      } : undefined

      const isLastBatch = to_section >= (book.num_sections ?? 30)
      const system = 'Tu es un générateur de JSON. Ta réponse entière doit être du JSON brut valide. Aucun texte avant ou après.'

      const batchRaw = await generateText(
        'claude', system,
        buildSectionBatchPrompt(bookParams, npcNames, locationNames, from_section, to_section, book.num_sections ?? 30, isLastBatch, previousSummaries, actInfo, corrections),
        8192
      )

      let batchStructure: { sections: any[] }
      try {
        batchStructure = JSON.parse(extractJson(batchRaw))
      } catch {
        throw new Error(`JSON invalide : ${batchRaw.slice(0, 200)}`)
      }
      if (!Array.isArray(batchStructure.sections)) throw new Error('Pas de tableau "sections"')

      // Get existing section IDs for this range
      const { data: existingSections } = await supabaseAdmin
        .from('sections').select('id, number').eq('book_id', bookId)
        .gte('number', from_section).lte('number', to_section)
      const sectionMap = new Map((existingSections ?? []).map((s: any) => [s.number, s.id]))

      let updated = 0
      let choicesInserted = 0

      for (const rawSec of batchStructure.sections) {
        const secId = sectionMap.get(rawSec.number)
        if (!secId) continue

        await supabaseAdmin.from('sections').update({
          summary: rawSec.summary ?? null,
          is_ending: rawSec.is_ending ?? false,
          ending_type: normalizeEndingType(rawSec.ending_type),
          narrative_arc: rawSec.narrative_arc ?? null,
          location_id: rawSec.location_name ? (locationNameMap.get(rawSec.location_name.toLowerCase()) ?? null) : null,
          trial: null,
        }).eq('id', secId)

        await supabaseAdmin.from('choices').delete().eq('section_id', secId)

        if (rawSec.choices?.length) {
          const newChoices = rawSec.choices
            .filter((c: any) => fullSectionMap.has(c.target_section))
            .map((c: any) => ({
              section_id: secId, label: c.label,
              target_section_id: fullSectionMap.get(c.target_section) ?? null,
              requires_trial: false, sort_order: c.sort_order ?? 0, is_back: c.is_back ?? false,
            }))
          if (newChoices.length) { await supabaseAdmin.from('choices').insert(newChoices); choicesInserted += newChoices.length }
        }

        if (rawSec.trial) {
          const rawTrial = rawSec.trial
          const npcData = rawTrial.enemy_name ? npcNameMap.get(rawTrial.enemy_name.toLowerCase()) : null
          const trial: Record<string, any> = {
            type: rawTrial.type, stat: rawTrial.stat,
            success_section_id: fullSectionMap.get(rawTrial.success_section) ?? null,
            failure_section_id: fullSectionMap.get(rawTrial.failure_section) ?? null,
            endurance_loss_on_failure: rawTrial.endurance_loss_on_failure ?? null,
            mana_cost: rawTrial.mana_cost ?? null, xp_reward: rawTrial.xp_reward ?? null,
            item_rewards: rawTrial.item_rewards ?? null,
            dialogue_opening: rawTrial.dialogue_opening ?? null,
            dialogue_goal: rawTrial.dialogue_goal ?? null,
          }
          if (npcData) { trial.npc_id = npcData.id; trial.enemy = { name: rawTrial.enemy_name, force: npcData.force, endurance: npcData.endurance } }
          await supabaseAdmin.from('sections').update({ trial }).eq('id', secId)
        }
        updated++
      }

      return { ok: true, updated, choices_inserted: choicesInserted, message: `§${from_section}-§${to_section} regénérées : ${updated} sections, ${choicesInserted} choix` }
    }

    case 'report_done':
      return { ok: true, ...input }

    default:
      throw new Error(`Outil inconnu: ${name}`)
  }
}

// ── Route SSE ────────────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { data: bookData } = await supabaseAdmin.from('books').select('title, num_sections').eq('id', id).single()
  if (!bookData) return new Response('Livre introuvable', { status: 404 })
  const book: { title: string; num_sections: number } = bookData

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  const send = (data: object) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  const systemPrompt = `Tu es un agent expert en correction de structures de livres-jeux "Dont Vous Êtes le Héros".

Livre : "${book.title}" (${book.num_sections} sections)

Ta mission : analyser et corriger TOUS les problèmes de cohérence structurelle et narrative.

PROCESSUS :
1. Appelle get_structure pour voir l'état complet (sections, choix, problèmes détectés)
2. Analyse les issues_summary — commence par les problèmes critiques (boucles, culs-de-sac, routages manquants)
3. Corrige chaque problème avec les outils appropriés, en justifiant tes choix narrativement
4. Pour les liens en arrière (backward links) : évalue si c'est intentionnel (retour narratif cohérent) ou une erreur (mauvais numéro de section)
5. Après avoir tout corrigé, appelle report_done avec le bilan

RÈGLES :
- Chaque correction doit être cohérente avec le résumé de la section et le contexte narratif
- Ne supprime jamais de choix existants — redirige-les vers une section plus appropriée
- Pour les culs-de-sac : crée des choix avec des libellés immersifs qui s'intègrent au résumé
- Pour les épreuves sans routage : success = section positive/continuation, failure = section de repli/conséquence
- Traite TOUS les problèmes de la liste issues_summary avant d'appeler report_done`

  async function runAgent() {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: `Lance l'analyse et la correction de la structure du livre "${book.title}". Commence par get_structure.` }
    ]

    send({ type: 'start', message: `Agent correcteur démarré pour "${book.title}"` })

    let iterations = 0
    const MAX_ITER = 25

    while (iterations < MAX_ITER) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        tools: AGENT_TOOLS,
        messages,
      })

      // Stream le raisonnement textuel
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          send({ type: 'thinking', message: block.text.trim() })
        }
      }

      // Collecter les tool_use
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

      if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
        send({ type: 'done', message: 'Agent terminé (aucun outil appelé)' })
        break
      }

      // Exécuter chaque outil
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tool of toolUses) {
        send({ type: 'tool_call', name: tool.name, input: tool.input })

        let result: any
        let isError = false
        try {
          result = await executeTool(tool.name, tool.input as Record<string, any>, id)
          send({ type: 'tool_result', name: tool.name, result })
        } catch (err: any) {
          result = { error: err.message }
          isError = true
          send({ type: 'tool_error', name: tool.name, error: err.message })
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify(result),
          is_error: isError,
        })

        // Stop si report_done
        if (tool.name === 'report_done') {
          send({ type: 'done', summary: (tool.input as any).summary, corrections: (tool.input as any).corrections_made, remaining: (tool.input as any).remaining_issues })
          return
        }
      }

      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })
      iterations++
    }

    if (iterations >= MAX_ITER) {
      send({ type: 'done', message: `Limite de ${MAX_ITER} itérations atteinte`, corrections: -1 })
    }
  }

  runAgent()
    .catch(err => send({ type: 'error', message: err.message }))
    .finally(() => writer.close())

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
